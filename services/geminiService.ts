import { GoogleGenAI, Type } from "@google/genai";
import { Question, Language, StudentAnswer, Analysis, Flashcard, DiagramSuggestion, DiagramGrade, TestAttempt, PracticeSuggestion } from '../types';
import { DEFAULT_CHAPTERS } from "../constants";
import { 
    getChaptersOpenAI, 
    generateQuestionsOpenAI,
    analyzeTestAttemptOpenAI,
    generateFlashcardsAIOpenAI,
    extractQuestionsFromImageAIOpenAI,
    suggestDiagramsAIOpenAI,
    gradeDiagramAIOpenAI,
    answerDoubtAIOpenAI,
    generateStudyGuideAIOpenAI,
    suggestPracticeSetsAIOpenAI,
    extractQuestionsFromPdfAIOpenAI,
    answerTeacherDoubtAIOpenAI,
    // FIX: Import the new text extraction fallback function.
    extractQuestionsFromTextAIOpenAI,
} from './openaiService';
import { supabase } from './supabaseClient';

const AI_OPERATION_TIMEOUT = 120000; // 120 seconds

const withTimeout = <T>(promise: Promise<T>, ms: number, featureName: string, signal?: AbortSignal): Promise<T> => {
    const promisesToRace: Promise<T>[] = [promise];

    const timeoutPromise = new Promise<T>((_, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`AI operation '${featureName}' timed out after ${ms / 1000} seconds.`));
        }, ms);
        // Clean up the timeout if the signal aborts or the main promise settles
        signal?.addEventListener('abort', () => clearTimeout(timeoutId));
        promise.finally(() => clearTimeout(timeoutId));
    });
    promisesToRace.push(timeoutPromise);
    
    if (signal) {
        const signalPromise = new Promise<T>((_, reject) => {
            if (signal.aborted) {
                return reject(new DOMException('Aborted', 'AbortError'));
            }
            signal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
            });
        });
        promisesToRace.push(signalPromise);
    }

    return Promise.race(promisesToRace);
};

const FALLBACK_API_KEY = process.env.API_KEY;

if (!FALLBACK_API_KEY) {
  console.warn("Fallback API_KEY environment variable not set. AI features will require user-provided key.");
}

// Helper for retry logic with exponential backoff
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(
  ai: GoogleGenAI,
  generationRequest: any,
  maxRetries = 5, // Increased from 3
  signal?: AbortSignal
): Promise<any> { // Using 'any' as it can return different response types from the SDK
  let attempt = 0;
  while (attempt < maxRetries) {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const requestWithSignal = { ...generationRequest, signal };
      if (generationRequest.model.includes('imagen')) {
        return await ai.models.generateImages(requestWithSignal);
      }
      return await ai.models.generateContent(requestWithSignal);
    } catch (error: any) {
      attempt++;
      
      let isRateLimitError = false;
      // The error object from the API can be nested or have different structures.
      // This checks for common patterns of rate limit errors.
      const errorDetails = error?.error || error; 
      const statusCode = errorDetails?.code || error?.status;
      const statusText = String(errorDetails?.status || '').toLowerCase();
      const messageText = String(errorDetails?.message || error?.message || '').toLowerCase();
      
      if (
        statusCode === 429 || 
        statusText === 'resource_exhausted' || 
        messageText.includes('quota') || 
        messageText.includes('rate limit')
      ) {
          isRateLimitError = true;
      }

      if (isRateLimitError && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
        console.warn(`Rate limit hit. Retrying in ${delay.toFixed(0)}ms... (Attempt ${attempt}/${maxRetries})`);
        await sleep(delay);
      } else {
        if (!isRateLimitError) {
            console.debug("Non-retryable error caught:", JSON.stringify(error, null, 2));
        }
        throw error; // Re-throw if not a rate limit error or retries exhausted
      }
    }
  }
  throw new Error("Max retries reached for AI generation.");
}


const languageMap: Record<Language, string> = {
    en: 'English',
    bn: 'Bengali',
    hi: 'Hindi',
};

const getStyleGuideline = (questionType?: string): string => {
    switch (questionType) {
        case 'Short Answer':
            return "For these Short Answer questions, create a mix of types: some asking for definitions, some for explanations of processes, and some for comparing/contrasting concepts.";
        case 'Multiple Choice':
            return "For these Multiple Choice questions, ensure the incorrect options (distractors) are plausible and related to the topic. Avoid trivial or obviously wrong answers.";
        case 'Fill in the Blanks':
            return "For these Fill in the Blanks questions, vary the sentence structure and the position of the blank (`____`).";
        case 'True/False':
            return "For these True/False questions, formulate statements that require careful consideration of the topic, not just simple fact recall.";
        case 'Odd Man Out':
            return "For these 'Odd Man Out' questions, ensure the items in each group share a clear, common characteristic, and the odd item is distinct for a specific, logical reason.";
        case 'Matching':
            return "For these 'Matching' questions, provide two columns. Ensure all items are from the same general topic to make it challenging, but maintain a single correct set of matches.";
        default:
            return "";
    }
}

export const generateQuestionsAI = async (
  criteria: {
    class: number;
    chapter: string;
    marks: number;
    difficulty: string;
    count: number;
    questionType?: string;
    keywords?: string;
    generateAnswer?: boolean;
    wbbseSyllabusOnly: boolean;
    lang: Language;
    useSearchGrounding?: boolean;
  },
  existingQuestions: Question[],
  userApiKey?: string,
  userOpenApiKey?: string
): Promise<{ generatedQuestions: Partial<Question>[], groundingChunks?: any[] }> => {
  const providers = [];
  if (userApiKey) providers.push({ type: 'gemini', key: userApiKey, name: "User's Gemini Key" });
  if (userOpenApiKey) providers.push({ type: 'openai', key: userOpenApiKey, name: "User's OpenAI Key" });
  if (FALLBACK_API_KEY && FALLBACK_API_KEY !== userApiKey) {
      providers.push({ type: 'gemini', key: FALLBACK_API_KEY, name: "System Fallback Key" });
  }

  if (providers.length === 0) {
      throw new Error("API Key is not configured. Please add your own key in Settings to use AI features.");
  }
  
  let lastError: any = null;

  for (const provider of providers) {
    try {
      console.log(`Attempting question generation with ${provider.name}`);
      if (provider.type === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: provider.key });
        const targetLanguage = languageMap[criteria.lang] || 'English';
        const existingQuestionTexts = existingQuestions.slice(0, 50).map(q => `- ${q.text}`).join('\n');
        const shouldGenerateAnswer = criteria.generateAnswer || ['Multiple Choice', 'Fill in the Blanks', 'True/False', 'Odd Man Out', 'Matching'].includes(criteria.questionType || '');
        
        if (criteria.questionType === 'Image-based') {
            const generatedQuestions: Partial<Question>[] = [];
            for (let i = 0; i < criteria.count; i++) {
                if (i > 0) await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit
                
                const textGenPrompt = `
You are an expert biology teacher creating a question for an exam.
Your task is to generate a single JSON object containing "questionText", "answerText", and "imagePrompt".

**Instructions:**
1.  **questionText**: Create a unique biology question based on the criteria below. This question MUST refer to a diagram (e.g., "Identify the part labeled 'X'...", "Describe the process shown in the diagram..."). Do NOT repeat questions from previous turns.
2.  **answerText**: Provide a concise, correct answer to the question. ${!shouldGenerateAnswer ? 'This field should be an empty string if an answer is not required.' : ''}
3.  **imagePrompt**: Write a clear and detailed prompt for an image generation AI. This prompt should describe the exact diagram needed to answer the question. It should be simple, biologically accurate, and include instructions for any necessary labels (e.g., "Label the nucleus with the letter 'A'.").
4.  All generated text MUST be in the **${targetLanguage}** language.

**Criteria for the Question:**
- Class: ${criteria.class}
- Topic: "${criteria.chapter}"
- Difficulty: ${criteria.difficulty}
- Marks: ${criteria.marks}

**Output Format:**
Return ONLY a single valid JSON object. Do not add any text before or after the JSON.
`;
                const responseSchema: any = {
                    type: Type.OBJECT,
                    properties: {
                        questionText: { type: Type.STRING, description: "The biology question that requires a diagram." },
                        imagePrompt: { type: Type.STRING, description: "A detailed prompt for an AI to generate the necessary diagram." },
                    },
                    required: ["questionText", "imagePrompt"],
                };
    
                if (shouldGenerateAnswer) {
                    responseSchema.properties.answerText = { type: Type.STRING, description: "The answer to the question." };
                    responseSchema.required.push("answerText");
                }
    
                const textResponse = await withTimeout(generateWithRetry(ai, {
                    model: 'gemini-2.5-flash',
                    contents: textGenPrompt,
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: responseSchema,
                    },
                }), AI_OPERATION_TIMEOUT, "Image-based Question Text Generation");
    
                const textResult = JSON.parse(textResponse.text.trim());
                const { questionText, answerText, imagePrompt } = textResult;
    
                if (!questionText || !imagePrompt) {
                    throw new Error("AI failed to generate the question text or image prompt.");
                }
                
                await new Promise(resolve => setTimeout(resolve, 1100));
    
                const imageResponse = await withTimeout(generateWithRetry(ai, {
                  model: 'imagen-4.0-generate-001',
                  prompt: imagePrompt,
                  config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                  },
                }), AI_OPERATION_TIMEOUT, "Image-based Question Image Generation");
                
                const generatedImage = imageResponse.generatedImages?.[0];
    
                if (!generatedImage?.image?.imageBytes) {
                    throw new Error("AI failed to generate a valid image from the provided prompt.");
                }
                
                const base64ImageBytes: string = generatedImage.image.imageBytes;
                const imageDataURL = `data:image/png;base64,${base64ImageBytes}`;
                
                generatedQuestions.push({
                  text: questionText,
                  answer: shouldGenerateAnswer ? answerText : undefined,
                  image_data_url: imageDataURL
                });
            }

            return { generatedQuestions, groundingChunks: undefined };
        }

        let formatInstructions = `Each question must be of the type: "${criteria.questionType || 'Short Answer'}".`;
        let jsonInstructions = 'The response must be a valid JSON array of objects.';

        const baseAnswerJson = `Each object must have two required fields: "text" and "answer".`;

        switch (criteria.questionType) {
            case 'Multiple Choice': formatInstructions = 'Each question MUST be a multiple-choice question with exactly 4 distinct options, labeled A, B, C, and D.'; jsonInstructions += `${baseAnswerJson}\n- The "text" field MUST contain the question followed by the 4 options, formatted like: "Question text? A) Option 1 B) Option 2 C) Option 3 D) Option 4".\n- The "answer" field MUST contain ONLY the capital letter of the correct option (e.g., "A", "B", "C", or "D").`; break;
            case 'Fill in the Blanks': formatInstructions = 'Each question MUST be a fill-in-the-blanks style question. Use one or more underscores `____` to represent the blank part.'; jsonInstructions += `${baseAnswerJson}\n- "text": The question text with blanks (e.g., "The powerhouse of the cell is the ____.").\n- "answer": The word or phrase that correctly fills the blank. If there are multiple blanks, provide the answers in order, separated by a comma.`; break;
            case 'True/False': formatInstructions = 'Each question MUST be a statement that can be answered with "True" or "False".'; jsonInstructions += `${baseAnswerJson}\n- "text": The statement to be evaluated (e.g., "Mitochondria are found in plant cells.").\n- "answer": The correct answer, which must be either "True" or "False".`; break;
            case 'Odd Man Out': formatInstructions = 'Each question MUST be an "Odd Man Out" type. It should provide a set of 4-5 items where one does not belong.'; jsonInstructions += `${baseAnswerJson}\n- "text": The list of items, typically labeled A, B, C, D (e.g., "A) Lion B) Tiger C) Bear D) Eagle").\n- "answer": The odd item, followed by a brief justification (e.g., "D) Eagle, because it is a bird while the others are mammals.").`; break;
            case 'Matching': formatInstructions = 'Each question MUST be a matching type with two columns, Column A and Column B, each containing 4-5 items.'; jsonInstructions += `${baseAnswerJson}\n- "text": The question text, including both columns formatted clearly (e.g., "Match Column A with Column B. Column A: 1. Mitochondria, 2. Ribosome... Column B: a. Protein synthesis, b. Powerhouse...").\n- "answer": A string representing the correct pairs (e.g., "1-b, 2-a, ...").`; break;
            default: if (shouldGenerateAnswer) { jsonInstructions += `${baseAnswerJson}\n- "text": The question text.\n- "answer": A concise and correct answer to the question.`; } else { jsonInstructions += `\nEach object must have one required field: "text". Do not include an "answer" field.`; } break;
        }

        const keywordInstructions = criteria.keywords ? `The questions must incorporate or be related to the following keywords: ${criteria.keywords}.` : '';
        const boardName = criteria.class >= 11 ? "WBCHSE" : "WBBSE";
        const boardFullName = criteria.class >= 11 ? "West Bengal Council of Higher Secondary Education (WBCHSE)" : "West Bengal Board of Secondary Education (WBBSE)";
        const syllabusInstruction = criteria.wbbseSyllabusOnly ? `You are an expert in creating biology question papers for the ${boardFullName} curriculum, specifically for Bengali Medium school students.\nYour task is to generate ${criteria.count} unique, high-quality questions based on the criteria below.\n**CRITICAL RULE: The content of all questions and answers MUST strictly adhere to the topics, scope, and depth of the official ${boardName} Biology syllabus for the specified class. DO NOT include any content from other educational boards like CBSE, ICSE, etc.**` : `You are an expert in creating biology question papers. Your task is to generate ${criteria.count} unique, high-quality questions based on the criteria below.`;

        const prompt = `
            ${syllabusInstruction}
            \n**CRITICAL INSTRUCTION: All generated text, including questions and answers, MUST be in the ${targetLanguage} language.**
            \nCriteria:\n- Class: ${criteria.class}\n- Chapter: "${criteria.chapter || 'Various Topics'}"\n- Marks for each question: ${criteria.marks}\n- Difficulty: ${criteria.difficulty}
            \nQuestion Style Guidelines:\n- **Variety is key.** Create a mix of questions that test different cognitive skills: some should test basic recall (e.g., 'What is...?'), others should require explanation (e.g., 'Explain why...'), and some should ask for analysis or comparison (e.g., 'Differentiate between...'). Use diverse sentence structures and avoid starting every question the same way.\n- ${getStyleGuideline(criteria.questionType)}
            \nSpecific Instructions for this Request:\n- ${formatInstructions}\n${keywordInstructions ? `- ${keywordInstructions}` : ''}
            \nIMPORTANT: Do NOT repeat any of the following questions that have been used before:\n${existingQuestionTexts.length > 0 ? existingQuestionTexts : "None"}
            \nOutput Format:\n${jsonInstructions.trim()}
        `;

        const responseSchema: any = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The full text of the question. For MCQs, this includes the question and 4 options (A, B, C, D)." } }, required: ["text"] } };
        if (shouldGenerateAnswer) { responseSchema.items.properties.answer = { type: Type.STRING, description: "A brief, optional answer. For MCQs, this MUST be the capital letter of the correct option (e.g., 'A'). For True/False, it MUST be 'True' or 'False'." }; responseSchema.items.required.push("answer"); }

        const config: any = { responseMimeType: "application/json", responseSchema: responseSchema };
        if (criteria.useSearchGrounding) { config.tools = [{ googleSearch: {} }]; delete config.responseMimeType; delete config.responseSchema; }

        const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: config }), AI_OPERATION_TIMEOUT, "Standard Question Generation");
        const jsonText = response.text.trim();
        let generated: { text: string; answer?: string }[] = [];
        try { generated = JSON.parse(jsonText); } catch (e) {
            console.warn("Direct JSON parsing failed, attempting to extract from markdown block.");
            const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) { try { generated = JSON.parse(jsonMatch[1].trim()); } catch (e2) { console.error("Failed to parse extracted JSON:", jsonMatch[1].trim(), e2); throw new Error("AI response was not valid JSON, even after extraction."); } } else { console.error("Failed to parse AI response as JSON and no markdown block found:", jsonText, e); throw new Error("AI response was not valid JSON."); }
        }
        
        const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (!Array.isArray(generated)) { console.error("AI did not return a valid array:", generated); return { generatedQuestions: [] }; }
        
        console.log(`Successfully generated questions with ${provider.name}.`);
        return { generatedQuestions: generated, groundingChunks };
      } else { // OpenAI provider
        const result = await withTimeout(generateQuestionsOpenAI(criteria, existingQuestions, provider.key), AI_OPERATION_TIMEOUT, "Question Generation (OpenAI)");
        console.log(`Successfully generated questions with ${provider.name}.`);
        return { ...result, groundingChunks: undefined };
      }
    } catch (error) {
      console.warn(`Provider ${provider.name} failed for generateQuestionsAI.`, error);
      lastError = error;
    }
  }

  console.error("All providers failed for generateQuestionsAI.");
  throw lastError || new Error("AI generation failed with all available keys. Please check your keys in Settings and your connection.");
};

const CHAPTERS_CACHE_KEY = 'eduquest_chapters_cache_v3';
interface ChaptersCache {
  [key: string]: {
    chapters: string[];
    timestamp: number;
  };
}

const SUBJECTS_CACHE_KEY = 'eduquest_subjects_cache_v1';
interface SubjectsCache {
  [key: string]: {
    subjects: string[];
    timestamp: number;
  };
}

export const getSubjectsAI = async (
  board: string,
  classNum: number,
  lang: Language,
  userGeminiApiKey?: string,
  userOpenAIApiKey?: string,
): Promise<string[]> => {
    const cacheKey = `${board}-${classNum}-${lang}`;
    const localCacheExpiry = 1000 * 60 * 60 * 24 * 7; // 1 week for localStorage
    const dbCacheStalePeriod = 1000 * 60 * 60 * 24 * 90; // 90 days for Supabase

    // 1. Check localStorage (quickest)
    try {
        const cachedDataRaw = localStorage.getItem(SUBJECTS_CACHE_KEY);
        if (cachedDataRaw) {
            const cache: SubjectsCache = JSON.parse(cachedDataRaw);
            if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < localCacheExpiry)) {
                return cache[cacheKey].subjects;
            }
        }
    } catch (e) { console.warn("Could not read subjects from localStorage cache", e); }

    const updateLocalCache = (subjects: string[]) => {
        try {
            const cachedDataRaw = localStorage.getItem(SUBJECTS_CACHE_KEY);
            const cache: SubjectsCache = cachedDataRaw ? JSON.parse(cachedDataRaw) : {};
            cache[cacheKey] = { subjects, timestamp: Date.now() };
            localStorage.setItem(SUBJECTS_CACHE_KEY, JSON.stringify(cache));
        } catch (e) { console.warn("Could not write subjects to localStorage cache", e); }
    };
    
    // 2. Check Supabase DB (persistent cache)
    try {
        const { data: dbData, error: dbError } = await supabase.from('subjects').select('subjects_list, updated_at').eq('board', board).eq('class', classNum).eq('lang', lang).single();
        if (dbError && dbError.code !== 'PGRST116') { console.warn("Error fetching subjects from Supabase cache:", dbError); }
        if (dbData?.subjects_list?.length > 0) {
            const isStale = (Date.now() - new Date(dbData.updated_at).getTime()) > dbCacheStalePeriod;
            if (!isStale) {
                updateLocalCache(dbData.subjects_list);
                return dbData.subjects_list;
            }
        }
    } catch (e) { console.error("Failed to query Supabase for subjects cache", e); }
    
    // 3. Fallback to AI API call
    const providers = createProviderList(userGeminiApiKey, userOpenAIApiKey);
    let subjectsFromAI: string[] | null = null;
    if (providers.length > 0) {
        for (const provider of providers) {
            try {
                console.log(`Attempting to fetch subjects with ${provider.name}`);
                if (provider.type === 'gemini') {
                    const ai = new GoogleGenAI({ apiKey: provider.key });
                    const prompt = `You are an expert on educational syllabi. List all academic subjects for the given curriculum.
                    
                    **Criteria:**
                    - Educational Board: ${board}
                    - Class: ${classNum}
                    - Language for subject names: ${languageMap[lang]}

                    Return ONLY a single valid JSON array of strings, where each string is a subject name. For example: ["Mathematics", "Science", "History"].`;
                    
                    const responseSchema = { type: Type.ARRAY, items: { type: Type.STRING } };
                    const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }), AI_OPERATION_TIMEOUT, "Subject List Generation");
                    
                    const subjectsResult = JSON.parse(response.text.trim());
                    if (Array.isArray(subjectsResult) && subjectsResult.every(item => typeof item === 'string')) {
                        subjectsFromAI = subjectsResult;
                        break;
                    } else {
                        throw new Error("Invalid format from Gemini.");
                    }
                }
            } catch (error) {
                console.warn(`Provider ${provider.name} failed for getSubjectsAI.`, error);
            }
        }
    }
    
    // 4. Update caches and return
    if (subjectsFromAI && subjectsFromAI.length > 0) {
        updateLocalCache(subjectsFromAI);
        supabase.from('subjects').upsert({ board: board, class: classNum, lang: lang, subjects_list: subjectsFromAI, updated_at: new Date().toISOString() }, { onConflict: 'board, class, lang' }).then(({ error: upsertError }) => { if (upsertError) { console.warn("Failed to cache subjects in Supabase:", upsertError); } });
        return subjectsFromAI;
    }
    
    // 5. Final fallback
    console.warn(`All AI options failed for subjects. Returning default list.`);
    return ['Biology', 'Life Science', 'Mathematics', 'Physics', 'Chemistry', 'History', 'Geography'];
};

export const getChaptersAI = async (
  board: string,
  classNum: number,
  subject: string,
  lang: Language,
  semester?: string,
  userGeminiApiKey?: string,
  userOpenAIApiKey?: string,
): Promise<string[]> => {
  const cacheKey = `${board}-${classNum}-${subject}-${lang}`;
  const localCacheExpiry = 1000 * 60 * 60 * 24 * 7; // 1 week for localStorage
  const dbCacheStalePeriod = 1000 * 60 * 60 * 24 * 90; // 90 days for Supabase

  try {
    const cachedDataRaw = localStorage.getItem(CHAPTERS_CACHE_KEY);
    if (cachedDataRaw) {
      const cache: ChaptersCache = JSON.parse(cachedDataRaw);
      if (cache[cacheKey] && (Date.now() - cache[cacheKey].timestamp < localCacheExpiry)) {
        return cache[cacheKey].chapters;
      }
    }
  } catch (e) { console.warn("Could not read chapters from localStorage cache", e); }

  const updateLocalCache = (chapters: string[]) => {
    try {
      const cachedDataRaw = localStorage.getItem(CHAPTERS_CACHE_KEY);
      const cache: ChaptersCache = cachedDataRaw ? JSON.parse(cachedDataRaw) : {};
      cache[cacheKey] = { chapters, timestamp: Date.now() };
      localStorage.setItem(CHAPTERS_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { console.warn("Could not write chapters to localStorage cache", e); }
  };

  try {
    const { data: dbData, error: dbError } = await supabase.from('chapters').select('chapters_list, updated_at').eq('board', board).eq('class', classNum).eq('lang', lang).eq('subject', subject).single();
    if (dbError && dbError.code !== 'PGRST116') { console.warn("Error fetching chapters from Supabase cache:", dbError); }
    if (dbData?.chapters_list?.length > 0) {
      const isStale = (Date.now() - new Date(dbData.updated_at).getTime()) > dbCacheStalePeriod;
      if (!isStale) { updateLocalCache(dbData.chapters_list); return dbData.chapters_list; }
    }
  } catch (e) { console.error("Failed to query Supabase for chapters cache", e); }

  const providers = [];
  if (userGeminiApiKey) providers.push({ type: 'gemini', key: userGeminiApiKey, name: "User's Gemini Key" });
  if (userOpenAIApiKey) providers.push({ type: 'openai', key: userOpenAIApiKey, name: "User's OpenAI Key" });
  if (FALLBACK_API_KEY && FALLBACK_API_KEY !== userGeminiApiKey) { providers.push({ type: 'gemini', key: FALLBACK_API_KEY, name: "System Fallback Key" }); }

  let chaptersFromAI: string[] | null = null;
  if (providers.length > 0) {
    for (const provider of providers) {
        try {
            console.log(`Attempting to fetch chapters with ${provider.name}`);
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const semesterInstruction = semester ? `- Semester: ${semester}` : '';
                const prompt = `You are an expert on educational syllabi. Your task is to list all chapters for a specific subject and curriculum.

**CRITICAL INSTRUCTION:** The list of chapters must be strictly for the specified subject ONLY. Do not include chapters from any other subjects.

**Criteria:**
- Subject: ${subject}
- Educational Board: ${board}
- Class: ${classNum}
${semesterInstruction}
- Language for chapter names: ${languageMap[lang]}

Return ONLY a single valid JSON array of strings, where each string is a chapter name.`;
                const responseSchema = { type: Type.ARRAY, items: { type: Type.STRING } };
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }), AI_OPERATION_TIMEOUT, "Chapter List Generation");
                const chaptersResult = JSON.parse(response.text.trim());
                if (Array.isArray(chaptersResult) && chaptersResult.every(item => typeof item === 'string')) { chaptersFromAI = chaptersResult; break; } else { throw new Error("Invalid format from Gemini."); }
            } else { // OpenAI
                const result = await withTimeout(getChaptersOpenAI(board, classNum, lang, provider.key, subject, semester), AI_OPERATION_TIMEOUT, "Chapter List Generation (OpenAI)");
                if (result) { chaptersFromAI = result; break; } else { throw new Error("OpenAI returned null."); }
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for getChaptersAI.`, error);
        }
    }
  }
  
  if (chaptersFromAI && chaptersFromAI.length > 0) {
    updateLocalCache(chaptersFromAI);
    supabase.from('chapters').upsert({ board: board, class: classNum, lang: lang, subject: subject, chapters_list: chaptersFromAI, updated_at: new Date().toISOString() }, { onConflict: 'board, class, lang, subject' }).then(({ error: upsertError }) => { if (upsertError) { console.warn("Failed to cache chapters in Supabase:", upsertError); } });
    return chaptersFromAI;
  }

  if (DEFAULT_CHAPTERS[classNum]) { console.warn(`Falling back to default chapters for class ${classNum}.`); return DEFAULT_CHAPTERS[classNum]; }
  console.warn(`All AI options failed for class ${classNum}, and no default chapters found. Returning empty list.`);
  return [];
};

const createProviderList = (userApiKey?: string, userOpenApiKey?: string) => {
    const providers = [];
    if (userApiKey) providers.push({ type: 'gemini', key: userApiKey, name: "User's Gemini Key" });
    if (userOpenApiKey) providers.push({ type: 'openai', key: userOpenApiKey, name: "User's OpenAI Key" });
    if (FALLBACK_API_KEY && FALLBACK_API_KEY !== userApiKey) {
        providers.push({ type: 'gemini', key: FALLBACK_API_KEY, name: "System Fallback Key" });
    }
    return providers;
};

const executeWithFallbacks = async <T>(
    providers: ReturnType<typeof createProviderList>,
    geminiExecutor: (ai: GoogleGenAI, signal?: AbortSignal) => Promise<T>,
    openAIExecutor: (apiKey: string, signal?: AbortSignal) => Promise<T>,
    featureName: string,
    signal?: AbortSignal
): Promise<T> => {
    if (providers.length === 0) {
        throw new Error("API Key is not configured for this feature.");
    }
    let lastError: any = null;
    for (const provider of providers) {
        try {
            console.log(`Attempting ${featureName} with ${provider.name}`);
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const result = await withTimeout(geminiExecutor(ai, signal), AI_OPERATION_TIMEOUT, featureName, signal);
                console.log(`Successfully executed ${featureName} with ${provider.name}.`);
                return result;
            } else {
                const result = await withTimeout(openAIExecutor(provider.key, signal), AI_OPERATION_TIMEOUT, `${featureName} (OpenAI)`, signal);
                console.log(`Successfully executed ${featureName} with ${provider.name}.`);
                return result;
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for ${featureName}.`, error);
            lastError = error;
        }
    }
    console.error(`All providers failed for ${featureName}.`);
    throw lastError || new Error(`${featureName} failed with all available keys. Please check your keys in Settings.`);
};

export const analyzeTestAttempt = async (questions: Question[], studentAnswers: StudentAnswer[], lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<Analysis> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const detailedAttempt = questions.map(q => `Question: ${q.text}\nChapter: ${q.chapter}\nCorrect Answer: ${q.answer}\nStudent's Answer: ${studentAnswers.find(sa => sa.questionId === q.id)?.answer || "Not Answered"}\n---`).join('\n');
            const prompt = `You are a helpful biology tutor. Analyze a student's test performance in ${languageMap[lang]}.\nTest Data:\n${detailedAttempt}\nReturn ONLY a single valid JSON object with "strengths" (array of strings), "weaknesses" (array of strings), and "summary" (string).`;
            const responseSchema = { type: Type.OBJECT, properties: { strengths: { type: Type.ARRAY, items: { type: Type.STRING } }, weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } }, summary: { type: Type.STRING } }, required: ["strengths", "weaknesses", "summary"] };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
            return JSON.parse(response.text.trim());
        },
        (apiKey) => analyzeTestAttemptOpenAI(questions, studentAnswers, lang, apiKey),
        "Test Analysis"
    );
};

export const generateFlashcardsAI = (chapter: string, classNum: number, count: number, lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<Flashcard[]> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const prompt = `Generate ${count} flashcards for Class ${classNum} on "${chapter}" in ${languageMap[lang]}. Output a valid JSON array of objects, each with a "question" and "answer" key.`;
            const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { question: { type: Type.STRING }, answer: { type: Type.STRING } }, required: ["question", "answer"] } };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
            return JSON.parse(response.text.trim());
        },
        (apiKey) => generateFlashcardsAIOpenAI(chapter, classNum, count, lang, apiKey),
        "Flashcard Generation"
    );
};

export const extractQuestionsFromImageAI = (imageDataUrl: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Partial<Question>[]> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai, sig) => {
            const mimeType = imageDataUrl.split(';')[0].split(':')[1];
            const base64Data = imageDataUrl.split(',')[1];
            const imagePart = { inlineData: { mimeType, data: base64Data } };
            const prompt = `Extract all questions from the image of an exam paper for Class ${classNum} in ${languageMap[lang]}. Return a valid JSON array of objects, each with "text" (string) and optional "marks" (number).`;
            const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING }, marks: { type: Type.NUMBER } }, required: ["text"] } };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: { parts: [{ text: prompt }, imagePart] }, config: { responseMimeType: "application/json", responseSchema } }, 5, sig);
            return JSON.parse(response.text.trim());
        },
        (apiKey, sig) => extractQuestionsFromImageAIOpenAI(imageDataUrl, classNum, lang, apiKey, sig),
        "Image Question Extraction",
        signal
    );
};

export const extractQuestionsFromPdfAI = async (
    pdfDataUrl: string,
    classNum: number,
    lang: Language,
    userApiKey?: string,
    userOpenApiKey?: string, // Kept for signature consistency, but not used.
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    const providers = createProviderList(userApiKey, undefined).filter(p => p.type === 'gemini');

    if (providers.length === 0) {
        throw new Error("A Google Gemini API Key is not configured for PDF processing. Please add one in Settings.");
    }
    let lastError: any = null;

    for (const provider of providers) {
        try {
            console.log(`Attempting PDF Question Extraction with ${provider.name}`);
            const ai = new GoogleGenAI({ apiKey: provider.key });

            const mimeType = 'application/pdf';
            const base64Data = pdfDataUrl.split(',')[1];
            if (!base64Data) {
                throw new Error("Invalid PDF data URL provided; could not extract base64 data.");
            }
            const pdfPart = { inlineData: { mimeType, data: base64Data } };
            const prompt = `You are an expert at analyzing PDF documents. Extract all distinct questions from the provided PDF of an exam paper. The paper is for Class ${classNum} and is in the ${languageMap[lang]} language. The PDF may have multiple pages.
- For each question, identify its full text.
- If marks are mentioned near a question, extract them.
- If the PDF is not a question paper, is password-protected, or is unreadable, return an empty array.
- Return the result as a valid JSON array of objects. Each object must have a "text" (string) and may have an optional "marks" (number) field.`;

            const responseSchema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        text: { type: Type.STRING },
                        marks: { type: Type.NUMBER }
                    },
                    required: ["text"]
                }
            };

            const PDF_EXTRACTION_TIMEOUT = 300000; // 5 minutes, as PDF processing can be slow.

            const response = await withTimeout(
                generateWithRetry(
                    ai,
                    {
                        model: 'gemini-2.5-pro',
                        contents: { parts: [{ text: prompt }, pdfPart] },
                        config: { responseMimeType: "application/json", responseSchema }
                    },
                    5, // maxRetries
                    signal
                ),
                PDF_EXTRACTION_TIMEOUT,
                "PDF Question Extraction",
                signal
            );

            const jsonText = response.text.trim();
            const parsedResult = JSON.parse(jsonText);

            if (!Array.isArray(parsedResult)) {
                console.warn("AI returned a non-array response for PDF extraction:", parsedResult);
                throw new Error("AI response was not in the expected array format.");
            }

            console.log(`Successfully extracted ${parsedResult.length} questions from PDF with ${provider.name}.`);
            return parsedResult;

        } catch (error) {
            console.warn(`Provider ${provider.name} failed for PDF Question Extraction.`, error);
            lastError = error;
        }
    }

    const errorDetails = lastError?.error || lastError;
    const messageText = String(lastError?.message || errorDetails?.message || '').toLowerCase();
    if (
        errorDetails?.status === 'RESOURCE_EXHAUSTED' ||
        errorDetails?.code === 429 ||
        messageText.includes('quota')
    ) {
        throw new Error("PDF processing failed due to API quota limits. Please check your key in Settings or try again later.");
    }
    
    throw lastError || new Error("PDF Question Extraction failed with all available Gemini keys. The file might be too complex, corrupted, or the service may be temporarily unavailable. Please try again later.");
};

// FIX: Add the missing extractQuestionsFromTextAI function.
export const extractQuestionsFromTextAI = (
    text: string,
    classNum: number,
    lang: Language,
    userApiKey?: string,
    userOpenApiKey?: string,
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai, sig) => {
            const prompt = `You are an expert at analyzing text. Extract all distinct questions from the provided text from an exam paper. The paper is for Class ${classNum} and is in the ${languageMap[lang]} language.
- For each question, identify its full text.
- If marks are mentioned near a question, extract them.
- Return the result as a valid JSON array of objects. Each object must have a "text" (string) and may have an optional "marks" (number) field.

Here is the text to analyze:
---
${text}
---
`;

            const responseSchema = {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        text: { type: Type.STRING },
                        marks: { type: Type.NUMBER }
                    },
                    required: ["text"]
                }
            };
            
            const response = await generateWithRetry(ai, { 
                model: 'gemini-2.5-flash', 
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema } 
            }, 5, sig);
            
            const jsonText = response.text.trim();
            const parsedResult = JSON.parse(jsonText);

            if (!Array.isArray(parsedResult)) {
                console.warn("AI returned a non-array response for text extraction:", parsedResult);
                throw new Error("AI response was not in the expected array format.");
            }

            return parsedResult;
        },
        (apiKey, sig) => extractQuestionsFromTextAIOpenAI(text, classNum, lang, apiKey, sig),
        "Text Question Extraction",
        signal
    );
};

export const suggestDiagramsAI = (chapter: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<DiagramSuggestion[]> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const prompt = `List the 3 most important diagrams for Class ${classNum} studying "${chapter}" in ${languageMap[lang]}. For each, provide its name, description, and an image generation prompt. Return a valid JSON array of objects with "name", "description", and "image_prompt" keys.`;
            const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, description: { type: Type.STRING }, image_prompt: { type: Type.STRING } }, required: ["name", "description", "image_prompt"] } };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-pro', contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
            return JSON.parse(response.text.trim());
        },
        (apiKey) => suggestDiagramsAIOpenAI(chapter, classNum, lang, apiKey),
        "Diagram Suggestion"
    );
};

export const gradeDiagramAI = (referenceImagePrompt: string, studentDrawingDataUrl: string, lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<DiagramGrade> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const imageResponse = await generateWithRetry(ai, { model: 'imagen-4.0-generate-001', prompt: referenceImagePrompt, config: { numberOfImages: 1, outputMimeType: 'image/png' } });
            const referenceImageBase64 = imageResponse.generatedImages?.[0]?.image?.imageBytes;
            if (!referenceImageBase64) throw new Error("Failed to generate a reference diagram.");
            await sleep(1100);
            const studentImageMimeType = studentDrawingDataUrl.split(';')[0].split(':')[1];
            const studentImageBase64 = studentDrawingDataUrl.split(',')[1];
            const prompt = `You are an expert biology teacher grading a student's diagram in ${languageMap[lang]}. The first image is the reference, the second is the student's. Evaluate accuracy, labeling, and neatness. Return a JSON object with "score" (number), "strengths" (array of strings), "areasForImprovement" (array of strings), and "feedback" (string).`;
            const responseSchema = { type: Type.OBJECT, properties: { score: { type: Type.NUMBER }, strengths: { type: Type.ARRAY, items: { type: Type.STRING } }, areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } }, feedback: { type: Type.STRING } }, required: ["score", "strengths", "areasForImprovement", "feedback"] };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: { parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: referenceImageBase64 } }, { inlineData: { mimeType: studentImageMimeType, data: studentImageBase64 } }] }, config: { responseMimeType: "application/json", responseSchema } });
            return JSON.parse(response.text.trim());
        },
        (apiKey) => gradeDiagramAIOpenAI(referenceImagePrompt, studentDrawingDataUrl, lang, apiKey),
        "Diagram Grading"
    );
};

export const answerDoubtAI = (classNum: number, lang: Language, text?: string, imageDataUrl?: string, userApiKey?: string, userOpenApiKey?: string): Promise<string> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const parts: any[] = [{ text: `You are a friendly biology tutor for a Class ${classNum} student. A student has a doubt in ${languageMap[lang]}. Explain clearly, using Markdown. Student's doubt: ${text || 'Please analyze the attached image.'}` }];
            if (imageDataUrl) { parts.push({ inlineData: { mimeType: imageDataUrl.split(';')[0].split(':')[1], data: imageDataUrl.split(',')[1] } }); }
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: { parts } });
            return response.text;
        },
        (apiKey) => answerDoubtAIOpenAI(classNum, lang, apiKey, text, imageDataUrl),
        "AI Tutor"
    );
};

export const answerTeacherDoubtAI = (classNum: number, lang: Language, text?: string, imageDataUrl?: string, userApiKey?: string, userOpenApiKey?: string): Promise<string> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const prompt = `You are an expert biology teaching assistant for a Class ${classNum} teacher. A teacher has a query in ${languageMap[lang]}. Provide a clear, detailed, and pedagogically sound explanation suitable for a teacher. Use Markdown for formatting. Teacher's query: ${text || 'Please analyze the attached image.'}`;
            const parts: any[] = [{ text: prompt }];
            if (imageDataUrl) { 
                const mimeType = imageDataUrl.split(';')[0].split(':')[1];
                const data = imageDataUrl.split(',')[1];
                parts.push({ inlineData: { mimeType, data } });
            }
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: { parts } });
            return response.text;
        },
        (apiKey) => answerTeacherDoubtAIOpenAI(classNum, lang, apiKey, text, imageDataUrl),
        "AI Teacher Tutor"
    );
};

export const generateStudyGuideAI = (chapter: string, classNum: number, topic: string, lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<string> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    return executeWithFallbacks(
        providers,
        async (ai) => {
            const prompt = `Create a concise study guide for a Class ${classNum} student on the "${topic}" from the chapter "${chapter}" in ${languageMap[lang]}. Format it well with Markdown.`;
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt });
            return response.text;
        },
        (apiKey) => generateStudyGuideAIOpenAI(chapter, classNum, topic, lang, apiKey),
        "Study Guide Generation"
    );
};

export const suggestPracticeSetsAI = (attempts: TestAttempt[], classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string): Promise<PracticeSuggestion[]> => {
    const providers = createProviderList(userApiKey, userOpenApiKey);
    const weaknesses = [...new Set(attempts.flatMap(a => a.analysis?.weaknesses || []))];
    if (weaknesses.length === 0) return Promise.resolve([]);

    return executeWithFallbacks(
        providers,
        async (ai) => {
            const prompt = `You are an expert biology tutor. A Class ${classNum} student has these weaknesses: \n- ${weaknesses.join('\n- ')}\nBased *only* on these, suggest up to 3 specific practice topics in ${languageMap[lang]}. Return a valid JSON array of objects. Each object must have "chapter", "topic", and "reason" keys.`;
            const responseSchema = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { chapter: { type: Type.STRING }, topic: { type: Type.STRING }, reason: { type: Type.STRING } }, required: ["chapter", "topic", "reason"] } };
            const response = await generateWithRetry(ai, { model: 'gemini-2.5-pro', contents: prompt, config: { responseMimeType: "application/json", responseSchema } });
            return JSON.parse(response.text.trim());
        },
        (apiKey) => suggestPracticeSetsAIOpenAI(attempts, classNum, lang, apiKey),
        "Practice Set Suggestion"
    );
};