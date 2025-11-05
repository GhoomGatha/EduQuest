import { Language, Question, StudentAnswer, Analysis, Flashcard, DiagramSuggestion, DiagramGrade, TestAttempt, PracticeSuggestion, Difficulty, Paper } from '../types';

const languageMap: Record<Language, string> = {
    en: 'English',
    bn: 'Bengali',
    hi: 'Hindi',
    ka: 'Kannada',
};

// Helper to call OpenAI Chat Completions API
async function openAIChatCompletion(apiKey: string, prompt: string, isJson: boolean = false, visionContent: any[] | null = null, signal?: AbortSignal) {
  const body: any = {
    model: visionContent ? 'gpt-4o' : 'gpt-4o-mini',
    messages: visionContent ? [{ role: 'user', content: visionContent }] : [{ role: 'user', content: prompt }],
    temperature: 0.5,
  };
  if (isJson) {
    body.response_format = { type: 'json_object' };
  }
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("OpenAI API error:", errorData);
    throw new Error(`OpenAI API request failed with status ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (isJson) {
    try {
      return JSON.parse(content);
    } catch (e) {
      console.error("Failed to parse OpenAI JSON response:", content);
      throw new Error("Invalid JSON response from OpenAI");
    }
  }
  return content;
}

// Helper to call OpenAI Image Generation (DALL-E) API
async function openAIImageGeneration(apiKey: string, prompt: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json'
        }),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json();
        console.error("OpenAI Image Generation error:", errorData);
        throw new Error(`OpenAI Image API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.data[0].b64_json;
}


// This will be called as a fallback by geminiService.
export const getChaptersOpenAI = async (
  board: string,
  classNum: number,
  lang: Language,
  openAIApiKey: string,
  subject: string,
  semester?: string,
  signal?: AbortSignal
): Promise<string[] | null> => {
  if (!openAIApiKey) {
    console.warn("OpenAI fallback called but no API key provided.");
    return null; // Indicates failure to the caller
  }

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

  try {
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    if (result && Array.isArray(result.chapters) && result.chapters.every((item: any) => typeof item === 'string')) {
        console.log("Successfully fetched chapters from OpenAI fallback.");
        return result.chapters;
    }
    
    console.warn("OpenAI response was not in the expected format.", result);
    return null; // Indicates failure to the caller

  } catch (error) {
    console.error("Error fetching chapters with OpenAI:", error);
    return null; // Indicates failure to the caller
  }
};

// Helper from geminiService.ts
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


export const generateQuestionsOpenAI = async (
  criteria: {
    class: number;
    subject: string;
    chapter: string;
    marks: number;
    difficulty: string;
    count: number;
    questionType?: string;
    keywords?: string;
    generateAnswer?: boolean;
    wbbseSyllabusOnly: boolean;
    lang: Language;
  },
  existingQuestions: Question[],
  openAIApiKey: string,
  signal?: AbortSignal,
): Promise<{ generatedQuestions: Partial<Question>[] }> => {
    const targetLanguage = languageMap[criteria.lang] || 'English';
    const shouldGenerateAnswer = criteria.generateAnswer || ['Multiple Choice', 'Fill in the Blanks', 'True/False', 'Odd Man Out', 'Matching'].includes(criteria.questionType || '');
    
    if (criteria.questionType === 'Image-based') {
        const generatedQuestions: Partial<Question>[] = [];
        for (let i = 0; i < criteria.count; i++) {
            if (i > 0) await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit

            const textGenPrompt = `
You are an expert ${criteria.subject} teacher creating a question for an exam.
Your task is to generate a single JSON object containing "questionText", "answerText", and "imagePrompt".

**Instructions:**
1.  **questionText**: Create a ${criteria.subject} question based on the criteria below. This question MUST refer to a diagram (e.g., "Identify the part labeled 'X'...", "Describe the process shown in the diagram...").
2.  **answerText**: Provide a concise, correct answer to the question. ${!shouldGenerateAnswer ? 'This field should be an empty string if an answer is not required.' : ''}
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
            const textResult = await openAIChatCompletion(openAIApiKey, textGenPrompt, true, null, signal);
            const { questionText, answerText, imagePrompt } = textResult;

            if (!questionText || !imagePrompt) {
                throw new Error("AI failed to generate the question text or image prompt.");
            }
            
            await new Promise(resolve => setTimeout(resolve, 1100)); // Rate limit

            const base64Image = await openAIImageGeneration(openAIApiKey, imagePrompt, signal);

            if (!base64Image) {
                throw new Error("AI failed to generate a valid image from the provided prompt.");
            }
            
            const imageDataURL = `data:image/png;base64,${base64Image}`;
            
            generatedQuestions.push({
              text: questionText,
              answer: shouldGenerateAnswer ? answerText : undefined,
              image_data_url: imageDataURL
            });
        }
        return { generatedQuestions };
    }

    let formatInstructions = `Each question must be of the type: "${criteria.questionType || 'Short Answer'}".`;
    let jsonInstructions = 'The response must be a valid JSON object containing a single key "questions", which is an array of objects.';

    const baseAnswerJson = `Each object must have two required fields: "text" and "answer".`;

    switch (criteria.questionType) {
        case 'Multiple Choice': formatInstructions = 'Each question MUST be a multiple-choice question with exactly 4 distinct options, labeled A, B, C, and D.'; jsonInstructions += `${baseAnswerJson}\n- The "text" field MUST contain the question followed by the 4 options, formatted like: "Question text? A) Option 1 B) Option 2 C) Option 3 D) Option 4".\n- The "answer" field MUST contain ONLY the capital letter of the correct option (e.g., "A", "B", "C", or "D").`; break;
        case 'Fill in the Blanks': formatInstructions = 'Each question MUST be a fill-in-the-blanks style question. Use one or more underscores \`____\` to represent the blank part.'; jsonInstructions += `${baseAnswerJson}\n- "text": The question text with blanks (e.g., "The powerhouse of the cell is the ____.").\n- "answer": The word or phrase that correctly fills the blank. If there are multiple blanks, provide the answers in order, separated by a comma.`; break;
        case 'True/False': formatInstructions = 'Each question MUST be a statement that can be answered with "True" or "False".'; jsonInstructions += `${baseAnswerJson}\n- "text": The statement to be evaluated (e.g., "Mitochondria are found in plant cells.").\n- "answer": The correct answer, which must be either "True" or "False".`; break;
        case 'Odd Man Out': formatInstructions = 'Each question MUST be an "Odd Man Out" type. It should provide a set of 4-5 items where one does not belong.'; jsonInstructions += `${baseAnswerJson}\n- "text": The list of items, typically labeled A, B, C, D (e.g., "A) Lion B) Tiger C) Bear D) Eagle").\n- "answer": The odd item, followed by a brief justification (e.g., "D) Eagle, because it is a bird while the others are mammals.").`; break;
        case 'Matching': formatInstructions = 'Each question MUST be a matching type with two columns, Column A and Column B, each containing 4-5 items.'; jsonInstructions += `${baseAnswerJson}\n- "text": The question text, including both columns formatted clearly (e.g., "Match Column A with Column B. Column A: 1. Mitochondria, 2. Ribosome... Column B: a. Protein synthesis, b. Powerhouse...").\n- "answer": A string representing the correct pairs (e.g., "1-b, 2-a, ...").`; break;
        default: if (shouldGenerateAnswer) { jsonInstructions += `${baseAnswerJson}\n- "text": The question text.\n- "answer": A concise and correct answer to the question.`; } else { jsonInstructions += `\nEach object must have one required field: "text". Do not include an "answer" field.`; } break;
    }

    const existingQuestionTexts = existingQuestions.slice(0, 50).map(q => `- ${q.text}`).join('\n');
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
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);

    if (!result || !Array.isArray(result.questions)) {
        console.error("OpenAI did not return a valid array of questions:", result);
        return { generatedQuestions: [] };
    }

    return { generatedQuestions: result.questions };
};

export const analyzeTestAttemptOpenAI = async (paper: Paper, studentAnswers: StudentAnswer[], lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<Analysis> => {
    const subject = paper.subject || 'Biology';
    const detailedAttempt = paper.questions.map(q => `Question: ${q.text}\nChapter: ${q.chapter}\nCorrect Answer: ${q.answer}\nStudent's Answer: ${studentAnswers.find(sa => sa.questionId === q.id)?.answer || "Not Answered"}\n---`).join('\n');
    const prompt = `You are a helpful ${subject} tutor. Analyze a student's test performance in ${languageMap[lang]}.\nTest Data:\n${detailedAttempt}\nReturn ONLY a single valid JSON object with "strengths" (array of strings), "weaknesses" (array of strings), and "summary" (string). Do not nest it under any other key.`;
    return await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
};

export const generateFlashcardsAIOpenAI = async (subject: string, chapter: string, classNum: number, count: number, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<Flashcard[]> => {
    const prompt = `Generate ${count} flashcards for ${subject}, Class ${classNum} on "${chapter}" in ${languageMap[lang]}. Output a valid JSON object with a single key "flashcards", which is an array of objects, each with a "question" and "answer" key.`;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.flashcards || [];
};

export const extractQuestionsFromImageAIOpenAI = async (imageDataUrl: string, classNum: number, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<Partial<Question>[]> => {
    const visionContent = [
        { type: "text", text: `Extract all questions from the image of an exam paper for Class ${classNum} in ${languageMap[lang]}. Return a valid JSON object with a key "questions" containing an array of objects, each with "text" (string) and optional "marks" (number).` },
        { type: "image_url", image_url: { url: imageDataUrl } }
    ];
    const result = await openAIChatCompletion(openAIApiKey, '', true, visionContent, signal);
    return result.questions || [];
};

export const suggestDiagramsAIOpenAI = async (subject: string, chapter: string, classNum: number, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<DiagramSuggestion[]> => {
    const prompt = `List the 3 most important diagrams for ${subject} for Class ${classNum} studying "${chapter}" in ${languageMap[lang]}. For each, provide its name, description, and an image generation prompt. Return a valid JSON object with a key "diagrams" which is an array of objects with "name", "description", and "image_prompt" keys.`;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.diagrams || [];
};

export const gradeDiagramAIOpenAI = async (subject: string, referenceImagePrompt: string, studentDrawingDataUrl: string, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<DiagramGrade> => {
    const referenceImageBase64 = await openAIImageGeneration(openAIApiKey, referenceImagePrompt, signal);
    await new Promise(resolve => setTimeout(resolve, 1100)); // Rate limit buffer
    
    const visionContent = [
        { type: "text", text: `You are an expert ${subject} teacher grading a student's diagram in ${languageMap[lang]}. The first image is the reference, the second is the student's. Evaluate accuracy, labeling, and neatness. Return a JSON object with "score" (number out of 10), "strengths" (array of strings), "areasForImprovement" (array of strings), and "feedback" (string). Do not nest it under any other key.` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${referenceImageBase64}` } },
        { type: "image_url", image_url: { url: studentDrawingDataUrl } }
    ];
    return await openAIChatCompletion(openAIApiKey, '', true, visionContent, signal);
};

export const answerDoubtAIOpenAI = async (classNum: number, lang: Language, openAIApiKey: string, text?: string, imageDataUrl?: string, signal?: AbortSignal): Promise<string> => {
    const visionContent: any[] = [{ type: 'text', text: `You are a friendly tutor for a Class ${classNum} student. A student has a doubt in ${languageMap[lang]}. Explain clearly, using Markdown. Student's doubt: ${text || 'Please analyze the attached image.'}` }];
    if (imageDataUrl) {
        visionContent.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }
    return await openAIChatCompletion(openAIApiKey, '', false, visionContent, signal);
};

export const generateStudyGuideAIOpenAI = async (subject: string, chapter: string, classNum: number, topic: string, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<string> => {
    const prompt = `Create a concise study guide for a Class ${classNum} student on the "${topic}" from the ${subject} chapter "${chapter}" in ${languageMap[lang]}. Format it well with Markdown.`;
    return await openAIChatCompletion(openAIApiKey, prompt, false, null, signal);
};

export const suggestPracticeSetsAIOpenAI = async (attempts: TestAttempt[], classNum: number, lang: Language, openAIApiKey: string, signal?: AbortSignal): Promise<PracticeSuggestion[]> => {
    const weaknesses = [...new Set(attempts.flatMap(a => a.analysis?.weaknesses || []))];
    if (weaknesses.length === 0) return [];
    
    const subject = attempts[0]?.paper?.subject || 'Biology';
    const prompt = `You are an expert ${subject} tutor. A Class ${classNum} student has these weaknesses: \n- ${weaknesses.join('\n- ')}\nBased *only* on these, suggest up to 3 specific practice topics in ${languageMap[lang]}. Return a valid JSON object with a key "suggestions" which is an array of objects. Each object must have "chapter", "topic", and "reason" keys.`;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.suggestions || [];
};

export const extractQuestionsFromPdfAIOpenAI = async (
    pdfDataUrl: string,
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
  // The current vision model API for OpenAI doesn't directly support PDF uploads in the same way Gemini does.
  // This would require a more complex implementation (e.g., using Assistants API or converting PDF to images).
  // For now, we'll indicate that this feature is not supported via the OpenAI fallback.
  throw new Error("PDF processing is only available with a Gemini API Key and is not supported via the OpenAI fallback.");
};

export const answerTeacherDoubtAIOpenAI = async (classNum: number, lang: Language, openAIApiKey: string, text?: string, imageDataUrl?: string, signal?: AbortSignal): Promise<string> => {
    const prompt = `You are an expert teaching assistant for a teacher of Class ${classNum}. The teacher has a query in ${languageMap[lang]}. Provide a clear, detailed, and pedagogically sound explanation suitable for a teacher. Use Markdown for formatting. Teacher's query: ${text || 'Please analyze the attached image.'}`;
    const visionContent: any[] | null = imageDataUrl ? [ { type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } } ] : null;
    return await openAIChatCompletion(openAIApiKey, visionContent ? '' : prompt, false, visionContent, signal);
};

export const extractQuestionsFromTextAIOpenAI = async (
    text: string,
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    const prompt = `You are an expert at analyzing text. Extract all distinct questions from the provided text from an exam paper. The paper is for Class ${classNum} and is in the ${languageMap[lang]} language.
- For each question, identify its full text.
- If marks are mentioned near a question, extract them.
- Return the result as a valid JSON object with a key "questions" which is an array of objects. Each object must have a "text" (string) and may have an optional "marks" (number) field.

Here is the text to analyze:
---
${text}
---
`;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.questions || [];
};
