

import { GoogleGenAI, Type } from "@google/genai";
import { Question, Language, StudentAnswer, Analysis, Flashcard, DiagramSuggestion, DiagramGrade, TestAttempt, PracticeSuggestion, Paper, FinalExamPaper, GroundingSource, FinalExamPaperQuestion } from '../types';
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
    extractQuestionsFromTextAIOpenAI,
    coachLongAnswerAIOpenAI,
    explainDiagramAIOpenAI,
} from './openaiService';
import { supabase } from './supabaseClient'; // Corrected import path

const AI_OPERATION_TIMEOUT = 120000; // 120 seconds
const AI_PAPER_GENERATION_TIMEOUT = 240000; // 240 seconds (4 minutes)

export const withTimeout = <T>(promise: Promise<T>, ms: number, featureName: string, signal?: AbortSignal): Promise<T> => {
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
                // FIX: Corrected DOMException constructor call
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
        // FIX: Corrected DOMException constructor call
        throw new DOMException('Aborted', 'AbortError');
    }
    try {
      if (generationRequest.model.includes('imagen')) {
        // Models.generateImages does not accept a signal in the options object directly,
        // It relies on underlying fetch/xhr which should respond to global abort or specific library implementations.
        // For @google/genai, signal is generally part of the top-level request object for `generateContent` or `generateContentStream`,
        // not nested under 'config' or `models.generateImages` specific options.
        const { config, ...rest } = generationRequest;
        return await ai.models.generateImages({ ...rest, config });
      }
      // For models.generateContent, the signal is a top-level property of the options object.
      return await ai.models.generateContent({ ...generationRequest, signal });
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
    ka: 'Kannada',
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
    subject: string;
    chapter?: string;
    marks?: number;
    difficulty: string;
    count?: number;
    questionType?: string;
    keywords?: string;
    generateAnswer?: boolean;
    wbbseSyllabusOnly: boolean;
    lang: Language;
    useSearchGrounding?: boolean;
    // New properties for batch paper generation
    paperStructure?: { count: number; marks: number; types: string[] }[];
    chapters?: string[];
  },
  existingQuestions: Question[],
  userApiKey?: string,
  userOpenApiKey?: string,
  // FIX: Added signal parameter to generateQuestionsAI
  signal?: AbortSignal
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
        
        if (criteria.questionType === 'Image-based') {
            const count = criteria.count || 1;

            const generateSingleImageQuestion = async (): Promise<Partial<Question> | null> => {
                try {
                    const textGenPrompt = `
You are an expert ${criteria.subject} teacher creating a question for an exam.
Your task is to generate a single JSON object containing "questionText", "answerText", and "imagePrompt".

**Instructions:**
1.  **questionText**: Create a unique ${criteria.subject} question based on the criteria below. This question MUST refer to a diagram (e.g., "Identify the part labeled 'X'...", "Describe the process shown in the diagram..."). Do NOT repeat questions from previous turns.
2.  **answerText**: Provide a concise, correct answer to the question. ${!criteria.generateAnswer ? 'This field should be an empty string if an answer is not required.' : ''}
3.  **imagePrompt**: Write a clear and detailed prompt for an image generation AI. This prompt should describe the exact diagram needed to answer the question. It should be simple, biologically accurate, and include instructions for any necessary labels (e.g., "Label the nucleus with the letter 'A'.").
4.  All generated text MUST be in the **${targetLanguage}** language.

**Criteria for the Question:**
- Subject: ${criteria.subject}
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
                            questionText: { type: Type.STRING, description: `The ${criteria.subject} question that requires a diagram.` },
                            imagePrompt: { type: Type.STRING, description: "A detailed prompt for an AI to generate the necessary diagram." },
                        },
                        required: ["questionText", "imagePrompt"],
                    };
        
                    if (criteria.generateAnswer) {
                        responseSchema.properties.answerText = { type: Type.STRING, description: "The answer to the question." };
                        responseSchema.required.push("answerText");
                    }
        
                    // FIX: Pass signal to generateWithRetry and withTimeout
                    const textResponse = await withTimeout(generateWithRetry(ai, {
                        model: 'gemini-2.5-flash',
                        contents: textGenPrompt,
                        config: {
                            responseMimeType: "application/json",
                            responseSchema: responseSchema,
                        },
                    }, 5, signal), AI_OPERATION_TIMEOUT, "Image-based Question Text Generation", signal);
        
                    const textResult = JSON.parse(textResponse.text.trim());
                    const { questionText, answerText, imagePrompt } = textResult;
        
                    if (!questionText || !imagePrompt) {
                        console.warn("AI failed to generate the question text or image prompt for one question.");
                        return null;
                    }
                    
                    // FIX: Pass signal to generateWithRetry and withTimeout
                    const imageResponse = await withTimeout(generateWithRetry(ai, {
                      model: 'imagen-4.0-generate-001',
                      prompt: imagePrompt,
                      config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/png',
                      },
                    }, 5, signal), AI_OPERATION_TIMEOUT, "Image-based Question Image Generation", signal);
                    
                    const generatedImage = imageResponse.generatedImages?.[0];
        
                    if (!generatedImage?.image?.imageBytes) {
                        console.warn("AI failed to generate a valid image from the provided prompt for one question.");
                        return null;
                    }
                    
                    const base64ImageBytes: string = generatedImage.image.imageBytes;
                    const imageDataURL = `data:image/png;base64,${base64ImageBytes}`;
                    
                    return {
                      text: questionText,
                      answer: criteria.generateAnswer ? answerText : undefined,
                      image_data_url: imageDataURL
                    };
                } catch (error) {
                    if (error instanceof DOMException && error.name === 'AbortError') {
                        throw error; // Re-throw abort errors to stop Promise.all
                    }
                    console.error("Error generating a single image-based question:", error);
                    return null; // Return null on other failures so Promise.all doesn't reject everything
                }
            };

            const promises = Array.from({ length: count }, () => generateSingleImageQuestion());
            const results = await Promise.all(promises);
            const generatedQuestions = results.filter((q): q is Partial<Question> => q !== null);

            return { generatedQuestions, groundingChunks: undefined };
        }
        
        // ** BATCH PAPER GENERATION LOGIC **
        if (criteria.paperStructure) {
            const structureDescription = criteria.paperStructure.map(req => {
                const typesString = req.types.map(t => `'${t}'`).join(' or ');
                return `- ${req.count} questions, each worth ${req.marks} marks. The question type for these should be chosen from: ${typesString}.`;
            }).join('\n');
            const chaptersString = (criteria.chapters || []).map(c => `"${c}"`).join(', ');
            const shouldGenerateAnswer = criteria.generateAnswer;
            const boardName = criteria.class >= 11 ? "WBCHSE" : "WBBSE";
            const boardFullName = criteria.class >= 11 ? "West Bengal Council of Higher Secondary Education (WBCHSE)" : "West Bengal Board of Secondary Education (WBBSE)";
            const syllabusInstruction = criteria.wbbseSyllabusOnly ? `You are an expert in creating question papers for the ${boardFullName} curriculum. **CRITICAL RULE: All questions MUST strictly adhere to the ${boardName} syllabus.**` : `You are an expert in creating question papers for the subject of ${criteria.subject}.`;

            const prompt = `
                ${syllabusInstruction}
                Your task is to generate a complete question paper as a single JSON object with a key "questions" which is an array of question objects.
                **CRITICAL INSTRUCTION: All generated text MUST be in the ${targetLanguage} language.**

                **Paper Structure:**
                ${structureDescription}

                **General Criteria:**
                - Subject: ${criteria.subject}
                - Class: ${criteria.class}
                - Difficulty for all questions: ${criteria.difficulty}
                - For each question, randomly select a chapter from this list: [${chaptersString}].

                **JSON Output Format:**
                The response must be a single valid JSON object: { "questions": [...] }.
                Each question object in the "questions" array must have these fields:
                - "text": The full question text. For MCQs, include 4 options (A, B, C, D).
                - "answer": The correct answer. ${!shouldGenerateAnswer ? 'This field should be an empty string.' : "For MCQs, this MUST be the capital letter of the correct option (e.g., 'A'). For True/False, it MUST be 'True' or 'False'."}
                - "marks": A number, which MUST match the marks specified for it in the structure.
                - "chapter": A string, which MUST be one of the chapters from the provided list.
                - "type": A string, which MUST be one of the types specified for its group.

                Ensure the total number of questions and their marks match the requested structure precisely. Do NOT repeat questions.
            `;
            
            const responseSchema = {
                type: Type.OBJECT,
                properties: {
                    questions: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                text: { type: Type.STRING },
                                answer: { type: Type.STRING },
                                marks: { type: Type.NUMBER },
                                chapter: { type: Type.STRING },
                                type: { type: Type.STRING },
                            },
                            required: ["text", "answer", "marks", "chapter", "type"],
                        }
                    }
                },
                required: ["questions"],
            };
            
            // FIX: Pass signal to generateWithRetry and withTimeout
            const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Batch Paper Generation", signal);
            const result = JSON.parse(response.text.trim());
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            const generated = result.questions || [];
            
            console.log(`Successfully generated paper with ${provider.name}.`);
            return { generatedQuestions: generated, groundingChunks };
        }


        // ** SINGLE GROUP GENERATION LOGIC (Legacy for Student App) **
        const shouldGenerateAnswer = criteria.generateAnswer || ['Multiple Choice', 'Fill in the Blanks', 'True/False', 'Odd Man Out', 'Matching'].includes(criteria.questionType || '');
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
        const syllabusInstruction = criteria.wbbseSyllabusOnly ? `You are an expert in creating question papers for the ${boardFullName} curriculum, specifically for Bengali Medium school students, for the subject of ${criteria.subject}.\nYour task is to generate ${criteria.count} unique, high-quality questions based on the criteria below.\n**CRITICAL RULE: The content of all questions and answers MUST strictly adhere to the topics, scope, and depth of the official ${boardName} ${criteria.subject} syllabus for the specified class. DO NOT include any content from other educational boards like CBSE, ICSE, etc.**` : `You are an expert in creating question papers for the subject of ${criteria.subject}. Your task is to generate ${criteria.count} unique, high-quality questions based on the criteria below.`;

        const prompt = `
            ${syllabusInstruction}
            \n**CRITICAL INSTRUCTION: All generated text, including questions and answers, MUST be in the ${targetLanguage} language.**
            \nCriteria:\n- Subject: ${criteria.subject}\n- Class: ${criteria.class}\n- Chapter: "${criteria.chapter || 'Various Topics'}"\n- Marks for each question: ${criteria.marks}\n- Difficulty: ${criteria.difficulty}
            \nQuestion Style Guidelines:\n- **Variety is key.** Create a mix of questions that test different cognitive skills: some should test basic recall (e.g., 'What is...?'), others should require explanation (e.g., 'Explain why...'), and some should ask for analysis or comparison (e.g., 'Differentiate between...'). Use diverse sentence structures and avoid starting every question the same way.\n- ${getStyleGuideline(criteria.questionType)}
            \nSpecific Instructions for this Request:\n- ${formatInstructions}\n${keywordInstructions ? `- ${keywordInstructions}` : ''}
            \nIMPORTANT: Do NOT repeat any of the following questions that have been used before:\n${existingQuestionTexts.length > 0 ? existingQuestionTexts : "None"}
            \nOutput Format:\n${jsonInstructions.trim()}
        `;

        const responseSchema: any = { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The full text of the question. For MCQs, this includes the question and 4 options (A, B, C, D)." } }, required: ["text"] } };
        if (shouldGenerateAnswer) { responseSchema.items.properties.answer = { type: Type.STRING, description: "A brief, optional answer. For MCQs, this MUST be the capital letter of the correct option (e.g., 'A'). For True/False, it MUST be 'True' or 'False'." }; responseSchema.items.required.push("answer"); }

        const config: any = { responseMimeType: "application/json", responseSchema: responseSchema };
        if (criteria.useSearchGrounding) { config.tools = [{ googleSearch: {} }]; delete config.responseMimeType; delete config.responseSchema; }

        // FIX: Pass signal to generateWithRetry and withTimeout
        const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: config }, 5, signal), AI_OPERATION_TIMEOUT, "Standard Question Generation", signal);
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
        // FIX: OpenAI fallback for single-group generation requires chapter, marks, and count fields, which might be undefined. Provide default values to prevent crashes.
        if (criteria.paperStructure) {
            console.warn("OpenAI fallback does not support batch paper generation. Skipping.");
            continue;
        }

        const openAICriteria = {
            ...criteria,
            chapter: criteria.chapter || 'Various Topics',
            marks: criteria.marks || 1,
            count: criteria.count || 1,
        };
        const result = await withTimeout(generateQuestionsOpenAI(openAICriteria, existingQuestions, provider.key, signal), AI_OPERATION_TIMEOUT, "Question Generation (OpenAI)", signal);
        console.log(`Successfully generated questions with ${provider.name}.`);
        return { ...result, groundingChunks: undefined };
      }
    } catch (error: any) {
        lastError = error;
        // Re-throw abort errors to ensure they are handled by the caller's catch block
        if (error.name === 'AbortError') {
            throw error;
        }
        console.warn(`Provider ${provider.name} failed for generateQuestionsAI.`, error);
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
  signal?: AbortSignal // FIX: Added signal parameter
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

        if (dbError && dbError.code !== 'PGRST116') { // PGRST116 is "exact one row not found"
            console.error("Supabase error fetching subjects:", dbError.message || dbError);
        } else if (dbData) {
            const isStale = (Date.now() - new Date(dbData.updated_at).getTime()) > dbCacheStalePeriod;
            if (!isStale) {
                updateLocalCache(dbData.subjects_list);
                return dbData.subjects_list;
            }
        }
    } catch (e) {
        console.warn("Could not read subjects from Supabase cache", e);
    }

    // 3. Fallback to AI generation
    const providers = [];
    if (userGeminiApiKey) providers.push({ type: 'gemini', key: userGeminiApiKey, name: "User's Gemini Key" });
    if (userOpenAIApiKey) providers.push({ type: 'openai', key: userOpenAIApiKey, name: "User's OpenAI Key" });
    if (FALLBACK_API_KEY && FALLBACK_API_KEY !== userGeminiApiKey) {
        providers.push({ type: 'gemini', key: FALLBACK_API_KEY, name: "System Fallback Key" });
    }

    if (providers.length === 0) {
        throw new Error("API Key is not configured. Please add your own key in Settings to use AI features.");
    }
    
    let lastError: any = null;

    for (const provider of providers) {
        try {
            console.log(`Attempting to fetch subjects with ${provider.name}`);
            let subjects: string[] | null = null;
            // OpenAI implementation would go here if it existed, for now this is Gemini only.
            // For simplicity, we assume Gemini will be used.
            const ai = new GoogleGenAI({ apiKey: provider.key });
            const prompt = `
                You are an expert on educational syllabi. Your task is to provide a list of all subjects for a specific curriculum.
                All subject names MUST be in the **${languageMap[lang] || 'English'}** language.

                **Criteria:**
                - Educational Board: ${board}
                - Class: ${classNum}

                Return ONLY a single valid JSON object with a single key "subjects", which contains an array of strings.
                Example: {"subjects": ["Life Science", "Physical Science", "Mathematics", "History"]}
            `;

            const responseSchema = {
                type: Type.OBJECT,
                properties: {
                    subjects: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                    },
                },
                required: ["subjects"],
            };

            // FIX: Pass signal to generateWithRetry and withTimeout
            const response = await withTimeout(generateWithRetry(ai, {
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: responseSchema,
                },
            }, 5, signal), AI_OPERATION_TIMEOUT, "Get Subjects", signal);

            const result = JSON.parse(response.text.trim());

            if (result && Array.isArray(result.subjects)) {
                subjects = result.subjects;
            }

            if (subjects) {
                updateLocalCache(subjects);
                // Update DB cache
                supabase.from('subjects').upsert({
                    board: board,
                    class: classNum,
                    lang: lang,
                    subjects_list: subjects,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'board,class,lang' }).then(({ error }) => {
                    if (error) console.error("Failed to update Supabase subjects cache:", error.message || error);
                });
                return subjects;
            }

        } catch (error) {
            console.warn(`Provider ${provider.name} failed for getSubjectsAI.`, error);
            lastError = error;
        }
    }

    throw lastError || new Error("All providers failed for getSubjectsAI.");
};

// FIX: Add all missing function exports that follow the provider-fallback pattern.

// Helper to create provider list
const getProviders = (userApiKey?: string, userOpenApiKey?: string) => {
    const providers = [];
    if (userApiKey) providers.push({ type: 'gemini', key: userApiKey, name: "User's Gemini Key" });
    if (userOpenApiKey) providers.push({ type: 'openai', key: userOpenApiKey, name: "User's OpenAI Key" });
    if (FALLBACK_API_KEY && FALLBACK_API_KEY !== userApiKey) {
        providers.push({ type: 'gemini', key: FALLBACK_API_KEY, name: "System Fallback Key" });
    }
    if (providers.length === 0) {
        throw new Error("API Key is not configured. Please add your own key in Settings to use AI features.");
    }
    return providers;
};

export const getChaptersAI = async (
    board: string,
    classNum: number,
    subject: string,
    lang: Language,
    semester?: string,
    userGeminiApiKey?: string,
    userOpenAIApiKey?: string,
    signal?: AbortSignal // FIX: Added signal parameter
): Promise<string[]> => {
    const semesterForDb = semester || 'all_semesters';
    const cacheKey = `${board}-${classNum}-${subject}-${lang}-${semesterForDb}`;
    const localCacheExpiry = 1000 * 60 * 60 * 24 * 7; // 1 week
    const dbCacheStalePeriod = 1000 * 60 * 60 * 24 * 90; // 90 days

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
        const { data: dbData, error: dbError } = await supabase.from('chapters')
            .select('chapters_list, updated_at')
            .eq('board', board)
            .eq('class', classNum)
            .eq('lang', lang)
            .eq('subject', subject)
            .eq('semester', semesterForDb)
            .single();

        if (dbError && dbError.code !== 'PGRST116') {
            console.error("Supabase error fetching chapters:", dbError.message || dbError);
        } else if (dbData) {
            const isStale = (Date.now() - new Date(dbData.updated_at).getTime()) > dbCacheStalePeriod;
            if (!isStale) {
                updateLocalCache(dbData.chapters_list);
                return dbData.chapters_list;
            }
        }
    } catch (e) { console.warn("Could not read chapters from Supabase cache", e); }

    const providers = getProviders(userGeminiApiKey, userOpenAIApiKey);
    let lastError: any = null;

    for (const provider of providers) {
        try {
            console.log(`Attempting to fetch chapters with ${provider.name}`);
            let chapters: string[] | null = null;
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const semesterInstruction = semester ? `- Semester: ${semester}` : '';
                const prompt = `
                    You are an expert on educational syllabi. Your task is to provide a comprehensive list of all chapters for a specific subject and curriculum.
                    **CRITICAL INSTRUCTION:** The list of chapters must be strictly for the specified subject ONLY. Do not include chapters from any other subjects.
                    All chapter names MUST be in the **${languageMap[lang] || 'English'}** language.

                    **Criteria:**
                    - Subject: ${subject}
                    - Educational Board: ${board}
                    - Class: ${classNum}
                    ${semesterInstruction}

                    Return ONLY a single valid JSON object with a single key "chapters", which contains an array of strings.
                    Example: {"chapters": ["The Living World", "Biological Classification", "Plant Kingdom"]}
                `;
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: { chapters: { type: Type.ARRAY, items: { type: Type.STRING }}},
                    required: ["chapters"],
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: 'application/json', responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Get Chapters", signal);
                const result = JSON.parse(response.text.trim());
                if (result && Array.isArray(result.chapters)) {
                    chapters = result.chapters;
                }
            } else { // openai
                chapters = await getChaptersOpenAI(board, classNum, lang, provider.key, subject, semester, signal);
            }

            if (chapters) {
                updateLocalCache(chapters);
                supabase.from('chapters').upsert({
                    board, class: classNum, lang, subject, semester: semesterForDb,
                    chapters_list: chapters,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'board,class,lang,subject,semester' }).then(({ error }) => {
                    if (error) console.error("Failed to update Supabase chapters cache:", error.message || error);
                });
                return chapters;
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for getChaptersAI.`, error);
            lastError = error;
        }
    }

    console.error("All providers failed for getChaptersAI. Using default chapters.", lastError);
    return DEFAULT_CHAPTERS[classNum] || [];
};

export const analyzeTestAttempt = async (paper: Paper, studentAnswers: StudentAnswer[], lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Analysis> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const detailedAttempt = paper.questions.map(q => `Question: ${q.text}\nChapter: ${q.chapter}\nCorrect Answer: ${q.answer}\nStudent's Answer: ${studentAnswers.find(sa => sa.questionId === q.id)?.answer || "Not Answered"}\n---`).join('\n');
                const prompt = `You are a helpful ${paper.subject || 'Biology'} tutor. Analyze a student's test performance in ${languageMap[lang]}.\nTest Data:\n${detailedAttempt}\nReturn ONLY a single valid JSON object with "strengths" (array of strings), "weaknesses" (array of strings), and "summary" (string). Do not nest it under any other key.`;
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                        weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                        summary: { type: Type.STRING }
                    },
                    required: ["strengths", "weaknesses", "summary"]
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Analyze Test Attempt", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(analyzeTestAttemptOpenAI(paper, studentAnswers, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Analyze Test Attempt (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for analyzeTestAttempt.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const generateFlashcardsAI = async (subject: string, chapter: string, classNum: number, count: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Flashcard[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `Generate ${count} flashcards for ${subject}, Class ${classNum} on "${chapter}" in ${languageMap[lang]}. Output a valid JSON array of objects, where each object has a "question" and "answer" key.`;
                 const responseSchema = {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            question: { type: Type.STRING },
                            answer: { type: Type.STRING }
                        },
                        required: ["question", "answer"]
                    }
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Generate Flashcards", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(generateFlashcardsAIOpenAI(subject, chapter, classNum, count, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Generate Flashcards (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for generateFlashcardsAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const extractQuestionsFromImageAI = async (imageDataUrl: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Partial<Question>[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                 const ai = new GoogleGenAI({ apiKey: provider.key });
                const imagePart = { inlineData: { mimeType: 'image/jpeg', data: imageDataUrl.split(',')[1] } };
                const textPart = { text: `Extract all questions from the image of an exam paper for Class ${classNum} in ${languageMap[lang]}. Return a valid JSON array of objects, each with "text" (string) and optional "marks" (number).` };
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
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-pro', contents: { parts: [imagePart, textPart] }, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Extract Questions from Image", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(extractQuestionsFromImageAIOpenAI(imageDataUrl, classNum, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Extract Questions from Image (OpenAI)', signal);
            }
        } catch (error) {
             console.warn(`Provider ${provider.name} failed for extractQuestionsFromImageAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const suggestDiagramsAI = async (subject: string, chapter: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<DiagramSuggestion[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `List up to 10 of the most important and commonly tested diagrams for ${subject} for Class ${classNum} studying "${chapter}" in ${languageMap[lang]}. For each, provide its name, description, and an image generation prompt. Return a valid JSON array of objects with "name", "description", and "image_prompt" keys.`;
                 const responseSchema = {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            description: { type: Type.STRING },
                            image_prompt: { type: Type.STRING }
                        },
                        required: ["name", "description", "image_prompt"]
                    }
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Suggest Diagrams", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(suggestDiagramsAIOpenAI(subject, chapter, classNum, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Suggest Diagrams (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for suggestDiagramsAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const gradeDiagramAI = async (subject: string, referenceImagePrompt: string, studentDrawingDataUrl: string, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<DiagramGrade> => {
     const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `You are an expert ${subject} teacher grading a student's diagram in ${languageMap[lang]}. The student was asked to draw a diagram based on this prompt: "${referenceImagePrompt}". The attached image is the student's drawing. Evaluate accuracy, labeling, and neatness. Provide qualitative feedback only. Return a JSON object with "strengths" (array of strings on what the student did well), "areasForImprovement" (array of strings on what to fix), and "feedback" (a detailed summary paragraph). Do not include a numerical score.`;
                const imagePart = { inlineData: { mimeType: 'image/png', data: studentDrawingDataUrl.split(',')[1] } };
                 const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                        areasForImprovement: { type: Type.ARRAY, items: { type: Type.STRING } },
                        feedback: { type: Type.STRING }
                    },
                    required: ["strengths", "areasForImprovement", "feedback"]
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-pro', contents: { parts: [imagePart, {text: prompt}] }, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Grade Diagram", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(gradeDiagramAIOpenAI(subject, referenceImagePrompt, studentDrawingDataUrl, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Grade Diagram (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for gradeDiagramAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const answerDoubtAI = async (classNum: number, lang: Language, text?: string, imageDataUrl?: string, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<{ text: string; imageUrl?: string }> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `You are a friendly tutor for a Class ${classNum} student in ${languageMap[lang]}. Analyze the student's doubt: "${text || 'Please analyze the attached image.'}"
                Your task is to provide a clear explanation and, if helpful, an image.
                **Instructions:**
                1. Formulate a helpful, clear explanation using Markdown.
                2. Decide if a diagram would significantly improve the explanation.
                3. Return a JSON object with "responseText" (your explanation) and "imagePrompt" (a detailed prompt for an image AI, or an empty string if no image is needed).`;

                let contents: any = { parts: [{ text: prompt }] };
                if (imageDataUrl) {
                    contents.parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: imageDataUrl.split(',')[1] } });
                }

                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        responseText: { type: Type.STRING },
                        imagePrompt: { type: Type.STRING }
                    },
                    required: ["responseText", "imagePrompt"]
                };

                const textResponse = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-pro', contents, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Answer Doubt", signal);
                const result = JSON.parse(textResponse.text.trim());
                const responseText = result.responseText;
                const imagePrompt = result.imagePrompt;
                let imageUrl: string | undefined = undefined;

                if (imagePrompt && imagePrompt.trim() !== "") {
                    await new Promise(resolve => setTimeout(resolve, 1100));
                    const imageResponse = await withTimeout(generateWithRetry(ai, {
                      model: 'imagen-4.0-generate-001',
                      prompt: imagePrompt,
                      config: { numberOfImages: 1, outputMimeType: 'image/png' },
                    }, 5, signal), AI_OPERATION_TIMEOUT, "Tutor Image Generation", signal);
                    
                    const generatedImage = imageResponse.generatedImages?.[0];
                    if (generatedImage?.image?.imageBytes) {
                        imageUrl = `data:image/png;base64,${generatedImage.image.imageBytes}`;
                    }
                }
                return { text: responseText, imageUrl };

            } else {
                const responseText = await withTimeout(answerDoubtAIOpenAI(classNum, lang, provider.key, text, imageDataUrl, signal), AI_OPERATION_TIMEOUT, 'Answer Doubt (OpenAI)', signal);
                return { text: responseText, imageUrl: undefined };
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for answerDoubtAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const generateStudyGuideAI = async (subject: string, chapter: string, classNum: number, topic: string, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<string> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `Create a concise study guide for a Class ${classNum} student on the "${topic}" from the ${subject} chapter "${chapter}" in ${languageMap[lang]}. Format it well with Markdown, using headings, bold text, and lists.`;
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt }, 5, signal), AI_OPERATION_TIMEOUT, "Generate Study Guide", signal);
                return response.text;
            } else {
                return await withTimeout(generateStudyGuideAIOpenAI(subject, chapter, classNum, topic, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Generate Study Guide (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for generateStudyGuideAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const suggestPracticeSetsAI = async (attempts: TestAttempt[], classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<PracticeSuggestion[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    const weaknesses = [...new Set(attempts.flatMap(a => a.analysis?.weaknesses || []))];
    if (weaknesses.length === 0) return [];
    
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                 const subject = attempts[0]?.paper?.subject || 'Biology';
                const prompt = `You are an expert ${subject} tutor. A Class ${classNum} student has these weaknesses: \n- ${weaknesses.join('\n- ')}\nBased *only* on these, suggest up to 3 specific practice topics in ${languageMap[lang]}. Return a valid JSON array of objects. Each object must have "chapter", "topic", and "reason" keys.`;
                 const responseSchema = {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            chapter: { type: Type.STRING },
                            topic: { type: Type.STRING },
                            reason: { type: Type.STRING }
                        },
                        required: ["chapter", "topic", "reason"]
                    }
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Suggest Practice Sets", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(suggestPracticeSetsAIOpenAI(attempts, classNum, lang, provider.key, signal), AI_OPERATION_TIMEOUT, 'Suggest Practice Sets (OpenAI)', signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for suggestPracticeSetsAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const extractQuestionsFromPdfAI = async (pdfDataUrl: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Partial<Question>[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                // Gemini supports PDF directly.
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const pdfPart = { inlineData: { mimeType: 'application/pdf', data: pdfDataUrl.split(',')[1] } };
                const textPart = { text: `Extract all questions from the PDF of an exam paper for Class ${classNum} in ${languageMap[lang]}. Return a valid JSON array of objects, each with "text" (string) and optional "marks" (number).` };
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
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-pro', contents: { parts: [textPart, pdfPart] }, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Extract Questions from PDF", signal);
                return JSON.parse(response.text.trim());
            } else { // OpenAI fallback
                return await withTimeout(extractQuestionsFromPdfAIOpenAI(pdfDataUrl, classNum, lang, provider.key, signal), AI_OPERATION_TIMEOUT, "Extract Questions from PDF (OpenAI)", signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for extractQuestionsFromPdfAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};


export const answerTeacherDoubtAI = async (classNum: number, lang: Language, text?: string, imageDataUrl?: string, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<{ text: string; imageUrl?: string; }> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `You are an expert teaching assistant for a teacher of Class ${classNum}. The teacher has a query in ${languageMap[lang]}.
                Your task is to provide a clear, detailed, and pedagogically sound explanation and, if helpful, an image.
                **Instructions:**
                1. Analyze the teacher's query: "${text || 'Please analyze the attached image.'}"
                2. Formulate a helpful explanation suitable for a teacher, using Markdown.
                3. Decide if a diagram would significantly improve the explanation for teaching purposes.
                4. Return a JSON object with "responseText" (your explanation) and "imagePrompt" (a detailed prompt for an image AI, or an empty string if no image is needed).`;
                
                let contents: any = { parts: [{ text: prompt }] };
                if (imageDataUrl) {
                    contents.parts.unshift({ inlineData: { mimeType: 'image/jpeg', data: imageDataUrl.split(',')[1] } });
                }

                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        responseText: { type: Type.STRING },
                        imagePrompt: { type: Type.STRING }
                    },
                    required: ["responseText", "imagePrompt"]
                };

                const textResponse = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-pro', contents, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Answer Teacher Doubt", signal);
                const result = JSON.parse(textResponse.text.trim());
                const responseText = result.responseText;
                const imagePrompt = result.imagePrompt;
                let imageUrl: string | undefined = undefined;

                if (imagePrompt && imagePrompt.trim() !== "") {
                    await new Promise(resolve => setTimeout(resolve, 1100));
                    const imageResponse = await withTimeout(generateWithRetry(ai, {
                      model: 'imagen-4.0-generate-001',
                      prompt: imagePrompt,
                      config: { numberOfImages: 1, outputMimeType: 'image/png' },
                    }, 5, signal), AI_OPERATION_TIMEOUT, "Tutor Image Generation", signal);
                    
                    const generatedImage = imageResponse.generatedImages?.[0];
                    if (generatedImage?.image?.imageBytes) {
                        imageUrl = `data:image/png;base64,${generatedImage.image.imageBytes}`;
                    }
                }
                return { text: responseText, imageUrl };
            } else {
                const responseText = await withTimeout(answerTeacherDoubtAIOpenAI(classNum, lang, provider.key, text, imageDataUrl, signal), AI_OPERATION_TIMEOUT, 'Answer Teacher Doubt (OpenAI)', signal);
                return { text: responseText, imageUrl: undefined };
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for answerTeacherDoubtAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const extractQuestionsFromTextAI = async (text: string, classNum: number, lang: Language, userApiKey?: string, userOpenApiKey?: string, signal?: AbortSignal): Promise<Partial<Question>[]> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                 const ai = new GoogleGenAI({ apiKey: provider.key });
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
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Extract Questions from Text", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(extractQuestionsFromTextAIOpenAI(text, classNum, lang, provider.key, signal), AI_OPERATION_TIMEOUT, "Extract Questions from Text (OpenAI)", signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for extractQuestionsFromTextAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const coachLongAnswerAI = async (
    question: string, 
    correctAnswer: string, 
    studentAnswer: string, 
    lang: Language, 
    userApiKey?: string, 
    userOpenApiKey?: string,
    signal?: AbortSignal // FIX: Added signal parameter
): Promise<{ analysisSummary: string; improvementCoaching: string }> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `You are an expert coach. A student was asked this question in ${languageMap[lang]}: "${question}". The model answer is: "${correctAnswer}". The student wrote: "${studentAnswer}". 
                Analyze the student's answer. Provide a summary of their points and compare them to the key concepts in the model answer. Then, offer actionable feedback on how they can improve their answer for an exam. 
                Return a valid JSON object with two keys: "analysisSummary" (string) and "improvementCoaching" (string).`;
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        analysisSummary: { type: Type.STRING, description: "Objective analysis and summary of the student's answer compared to the model answer." },
                        improvementCoaching: { type: Type.STRING, description: "Actionable, personalized feedback for improvement." }
                    },
                    required: ["analysisSummary", "improvementCoaching"]
                };
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt, config: { responseMimeType: "application/json", responseSchema } }, 5, signal), AI_OPERATION_TIMEOUT, "Coach Long Answer", signal);
                return JSON.parse(response.text.trim());
            } else {
                return await withTimeout(coachLongAnswerAIOpenAI(question, correctAnswer, studentAnswer, lang, provider.key, signal), AI_OPERATION_TIMEOUT, "Coach Long Answer (OpenAI)", signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for coachLongAnswerAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const explainDiagramAI = async (
    imagePrompt: string, 
    lang: Language, 
    userApiKey?: string, 
    userOpenApiKey?: string,
    signal?: AbortSignal // FIX: Added signal parameter
): Promise<string> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;
    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const prompt = `You are an expert biology teacher. Explain the diagram described by this prompt in detail, in the ${languageMap[lang]} language: "${imagePrompt}". Describe its parts, their functions, and the overall process shown. Use Markdown for clear formatting.`;
                // FIX: Pass signal to generateWithRetry and withTimeout
                const response = await withTimeout(generateWithRetry(ai, { model: 'gemini-2.5-flash', contents: prompt }, 5, signal), AI_OPERATION_TIMEOUT, "Explain Diagram", signal);
                return response.text;
            } else {
                return await withTimeout(explainDiagramAIOpenAI(imagePrompt, lang, provider.key, signal), AI_OPERATION_TIMEOUT, "Explain Diagram (OpenAI)", signal);
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for explainDiagramAI.`, error);
            lastError = error;
        }
    }
    throw lastError;
};

export const generateFinalExamPaperAI = async (
  board: string,
  classNum: number,
  subject: string,
  year: number,
  lang: Language,
  userApiKey?: string,
  userOpenApiKey?: string,
  signal?: AbortSignal,
): Promise<FinalExamPaper | null> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;

    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const targetLanguage = languageMap[lang] || 'English';

                const prompt = `
                    You are an expert paper setter for the ${board} educational board.
                    Your task is to generate a complete, realistic final exam question paper based on the following criteria.
                    The paper must be structured with appropriate sections (e.g., Group A, Group B) and a variety of question types (like MCQs, short answers, long answers).

                    **CRITICAL INSTRUCTIONS:**
                    1.  All generated text MUST be in the **${targetLanguage}** language.
                    2.  The output MUST be a single valid JSON object. Do not add any text before or after the JSON.
                    3.  The JSON must match the specified schema precisely.

                    **Paper Criteria:**
                    - Board: ${board}
                    - Class: ${classNum}
                    - Subject: ${subject}
                    - Exam Year: ${year}

                    **Example Structure (follow this format):**
                    The 'paper_content' should have a 'title' and an array of 'sections'. Each section has a 'title' and an array of 'questions'. Each question has a 'q_num' (question number like "1.1" or "2. (a)"), 'text', 'marks', and optional 'options' for MCQs.
                `;

                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: `The main title of the exam paper, e.g., "${subject} - Final Examination ${year}"` },
                        sections: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    title: { type: Type.STRING, description: "The title of the section, e.g., 'Group A: Multiple Choice Questions'" },
                                    questions: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                q_num: { type: Type.STRING, description: "The question number, e.g., '1.1' or '2. (a)'" },
                                                text: { type: Type.STRING, description: "The full text of the question." },
                                                marks: { type: Type.NUMBER, description: "The marks for the question." },
                                                options: {
                                                    type: Type.ARRAY,
                                                    items: { type: Type.STRING },
                                                    description: "An array of strings for multiple choice options, if applicable."
                                                },
                                                answer: {
                                                    type: Type.STRING,
                                                    description: "Optional: The correct answer key for the question."
                                                }
                                            },
                                            required: ["q_num", "text", "marks"],
                                        }
                                    }
                                },
                                required: ["title", "questions"],
                            }
                        }
                    },
                    required: ["title", "sections"],
                };

                const response = await withTimeout(generateWithRetry(ai, {
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: {
                                paper_content: responseSchema
                            },
                            required: ["paper_content"]
                        }
                    },
                }, 5, signal), AI_PAPER_GENERATION_TIMEOUT, "Generate Final Exam Paper", signal);

                const result = JSON.parse(response.text.trim());
                
                if (result.paper_content) {
                    const generatedPaper: FinalExamPaper = {
                        id: `ai-gen-${Date.now()}`,
                        board,
                        class: classNum,
                        subject,
                        exam_year: year,
                        paper_content: result.paper_content,
                        created_at: new Date().toISOString(),
                    };
                    return generatedPaper;
                }
            } else {
                console.warn("OpenAI fallback for final exam paper generation is not implemented. Skipping.");
                continue;
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for generateFinalExamPaperAI.`, error);
            lastError = error;
        }
    }
    
    if (lastError) throw lastError;
    return null;
};

export const findAndRecreateFinalExamPaperAI = async (
  board: string,
  classNum: number,
  subject: string,
  year: number,
  lang: Language,
  userApiKey?: string,
  userOpenApiKey?: string,
  signal?: AbortSignal,
): Promise<{ paper: FinalExamPaper, sources: GroundingSource[] } | null> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;

    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const targetLanguage = languageMap[lang] || 'English';

                const prompt = `
                    You are an expert academic archivist. Your task is to find the official final exam question paper from the web and recreate it precisely in a structured JSON format.

                    **CRITICAL INSTRUCTIONS:**
                    1.  Use your search capabilities to find the official paper matching the criteria below.
                    2.  If you find the paper, recreate its entire structure, including all sections, question numbers (e.g., "1.1", "2. (a)"), question text, and marks for each question.
                    3.  All generated text MUST be in the **${targetLanguage}** language.
                    4.  The output MUST be a single valid JSON object with a key "paper_content". Do not add any text before or after the JSON.
                    5.  If you CANNOT find the official paper online, your entire response MUST be just the string "NOT_FOUND".

                    **Paper Criteria:**
                    - Board: ${board}
                    - Class: ${classNum}
                    - Subject: ${subject}
                    - Exam Year: ${year}

                    **JSON Output Format (if found):**
                    {
                        "paper_content": {
                            "title": "Example: ${subject} - Final Examination ${year}",
                            "sections": [
                                {
                                    "title": "Example: Group A: Multiple Choice Questions",
                                    "questions": [
                                        {
                                            "q_num": "1.1",
                                            "text": "Full question text here...",
                                            "marks": 1,
                                            "options": ["Option A", "Option B", "Option C", "Option D"]
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                `;

                const response = await withTimeout(generateWithRetry(ai, {
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        tools: [{ googleSearch: {} }],
                    },
                }, 5, signal), AI_PAPER_GENERATION_TIMEOUT, "Find and Recreate Final Exam Paper", signal);

                const jsonText = response.text.trim();

                if (jsonText === 'NOT_FOUND') {
                    console.log(`AI search could not find the paper for ${year} ${subject}.`);
                    return null;
                }

                let result: any;
                try {
                    result = JSON.parse(jsonText);
                } catch (e) {
                    console.warn("Direct JSON parsing failed for searched paper, attempting to extract from markdown block.");
                    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                    if (jsonMatch && jsonMatch[1]) {
                        try {
                            result = JSON.parse(jsonMatch[1].trim());
                        } catch (e2) {
                            console.error("Failed to parse extracted JSON for searched paper:", jsonMatch[1].trim(), e2);
                            throw new Error("AI response was not valid JSON, even after extraction.");
                        }
                    } else {
                        console.error("Failed to parse AI response for searched paper and no markdown block found:", jsonText, e);
                        throw new Error("AI response was not valid JSON.");
                    }
                }
                
                const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
                const sources = groundingChunks
                    ?.map((chunk: any) => chunk.web)
                    .filter(Boolean)
                    .map((source: any) => ({ uri: source.uri, title: source.title }))
                    .filter((source: any, index: number, self: any[]) => index === self.findIndex(s => s.uri === source.uri));

                if (result.paper_content) {
                    const foundPaper: FinalExamPaper = {
                        id: `ai-search-${Date.now()}`,
                        board,
                        class: classNum,
                        subject,
                        exam_year: year,
                        paper_content: result.paper_content,
                        created_at: new Date().toISOString(),
                    };
                    return { paper: foundPaper, sources: sources || [] };
                }

                return null; // Return null if JSON structure is wrong

            } else {
                console.warn("OpenAI fallback for final exam paper search is not implemented. Skipping.");
                continue;
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for findAndRecreateFinalExamPaperAI.`, error);
            lastError = error;
        }
    }
    
    if (lastError) throw lastError;
    return null;
}

export const analyzeAndSuggestPaperAI = async (
  fileDataUrl: string,
  targetYear: number,
  board: string,
  classNum: number,
  subject: string,
  lang: Language,
  userApiKey?: string,
  userOpenApiKey?: string,
  signal?: AbortSignal,
): Promise<FinalExamPaper | null> => {
    const providers = getProviders(userApiKey, userOpenApiKey);
    let lastError: any = null;

    for (const provider of providers) {
        try {
            if (provider.type === 'gemini') {
                const ai = new GoogleGenAI({ apiKey: provider.key });
                const targetLanguage = languageMap[lang] || 'English';
                const [header, data] = fileDataUrl.split(',');
                const mimeType = header.match(/:(.*?);/)?.[1];
                if (!mimeType) throw new Error("Could not determine file type from data URL.");

                const filePart = { inlineData: { mimeType, data } };
                
                const prompt = `
                    You are an expert paper setter for the ${board} educational board, specializing in ${subject} for Class ${classNum}.
                    Your task is to analyze an uploaded past exam paper and generate a NEW, predictive paper for a future year.

                    **Analysis Task:**
                    1.  Thoroughly analyze the provided file, which is a past exam paper.
                    2.  Identify its structure: sections (e.g., Group A), question numbering (e.g., 1.1, 2. (a)), question types (MCQ, short answer, etc.), and mark distribution.
                    3.  Identify the key chapters and topics covered and their relative weightage.

                    **Generation Task:**
                    1.  Based on your analysis, generate a **completely new and unique** question paper for the target exam year: **${targetYear}**.
                    2.  The generated paper should be **structurally similar** to the provided paper (same sections, similar question count and mark distribution).
                    3.  The topics should be relevant and follow the same weightage as the original paper, but the **questions themselves must be different**.
                    4.  All generated text MUST be in the **${targetLanguage}** language.
                    5.  The output MUST be a single valid JSON object, with no other text before or after it.

                    **JSON Output Schema:**
                    The JSON object must have a single root key "paper_content", which contains "title" and "sections". Each section has a "title" and an array of "questions". Each question object must have "q_num", "text", "marks", and optional "options" for MCQs and an optional "answer".
                `;

                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: `The main title of the exam paper, e.g., "${subject} - Final Examination ${targetYear}"` },
                        sections: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    title: { type: Type.STRING, description: "The title of the section, e.g., 'Group A: Multiple Choice Questions'" },
                                    questions: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                q_num: { type: Type.STRING, description: "The question number, e.g., '1.1' or '2. (a)'" },
                                                text: { type: Type.STRING, description: "The full text of the question." },
                                                marks: { type: Type.NUMBER, description: "The marks for the question." },
                                                options: {
                                                    type: Type.ARRAY,
                                                    items: { type: Type.STRING },
                                                    description: "An array of strings for multiple choice options, if applicable."
                                                },
                                                answer: {
                                                    type: Type.STRING,
                                                    description: "Optional: The correct answer key for the question."
                                                }
                                            },
                                            required: ["q_num", "text", "marks"],
                                        }
                                    }
                                },
                                required: ["title", "questions"],
                            }
                        }
                    },
                    required: ["title", "sections"],
                };

                const response = await withTimeout(generateWithRetry(ai, {
                    model: 'gemini-2.5-pro',
                    contents: { parts: [{ text: prompt }, filePart] },
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: Type.OBJECT,
                            properties: { paper_content: responseSchema },
                            required: ["paper_content"]
                        }
                    },
                }, 5, signal), AI_PAPER_GENERATION_TIMEOUT, "Analyze and Suggest Paper", signal);

                const result = JSON.parse(response.text.trim());
                
                if (result.paper_content) {
                    const generatedPaper: FinalExamPaper = {
                        id: `ai-suggest-${Date.now()}`,
                        board,
                        class: classNum,
                        subject,
                        exam_year: targetYear,
                        paper_content: result.paper_content,
                        created_at: new Date().toISOString(),
                    };
                    return generatedPaper;
                }
            } else {
                console.warn("OpenAI fallback for paper analysis is not implemented. Skipping.");
                continue;
            }
        } catch (error) {
            console.warn(`Provider ${provider.name} failed for analyzeAndSuggestPaperAI.`, error);
            lastError = error;
        }
    }
    
    if (lastError) throw lastError;
    return null;
};