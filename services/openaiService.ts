import { Language, Question, StudentAnswer, Analysis, Flashcard, DiagramSuggestion, DiagramGrade, TestAttempt, PracticeSuggestion, Difficulty } from '../types';

export const OPENAI_API_KEY_STORAGE_KEY = 'eduquest_user_openai_api_key';

const languageMap: Record<Language, string> = {
    en: 'English',
    bn: 'Bengali',
    hi: 'Hindi',
    // FIX: Add missing Kannada language mapping.
    kn: 'Kannada',
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

// --- Start of newly added functions ---

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
      const textGenPrompt = `
You are an expert biology teacher creating a question for an exam.
Your task is to generate a single JSON object containing "questionText", "answerText", and "imagePrompt".

**Instructions:**
1.  **questionText**: Create a biology question based on the criteria below. This question MUST refer to a diagram (e.g., "Identify the part labeled 'X'...", "Describe the process shown in the diagram...").
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
      const textResult = await openAIChatCompletion(openAIApiKey, textGenPrompt, true, null, signal);
      const { questionText, answerText, imagePrompt } = textResult;

      if (!questionText || !imagePrompt) {
          throw new Error("OpenAI failed to generate the question text or image prompt.");
      }
      
      const base64ImageBytes = await openAIImageGeneration(openAIApiKey, imagePrompt, signal);
      const imageDataURL = `data:image/png;base64,${base64ImageBytes}`;
      
      return {
          generatedQuestions: [{
            text: questionText,
            answer: shouldGenerateAnswer ? answerText : undefined,
            image_data_url: imageDataURL
          }]
      };
    }
    
    let formatInstructions = `Each question must be of the type: "${criteria.questionType || 'Short Answer'}".`;
    let jsonInstructions = 'Return ONLY a single valid JSON object with one key "questions", which contains an array of objects.';

    const baseAnswerJson = `Each object in the "questions" array must have two required fields: "text" and "answer".`;
    switch (criteria.questionType) {
        case 'Multiple Choice':
        formatInstructions = 'Each question MUST be a multiple-choice question with exactly 4 distinct options, labeled A, B, C, and D.';
        jsonInstructions += `${baseAnswerJson}
- The "text" field MUST contain the question followed by the 4 options, formatted like: "Question text? A) Option 1 B) Option 2 C) Option 3 D) Option 4".
- The "answer" field MUST contain ONLY the capital letter of the correct option (e.g., "A", "B", "C", or "D").`;
        break;
        case 'Fill in the Blanks':
        formatInstructions = 'Each question MUST be a fill-in-the-blanks style question. Use one or more underscores \`____\` to represent the blank part.';
        jsonInstructions += `${baseAnswerJson}
- "text": The question text with blanks (e.g., "The powerhouse of the cell is the ____.").
- "answer": The word or phrase that correctly fills the blank. If there are multiple blanks, provide the answers in order, separated by a comma.`;
        break;
        case 'True/False':
        formatInstructions = 'Each question MUST be a statement that can be answered with "True" or "False".';
        jsonInstructions += `${baseAnswerJson}
- "text": The statement to be evaluated (e.g., "Mitochondria are found in plant cells.").
- "answer": The correct answer, which must be either "True" or "False".`;
        break;
        default:
            if (shouldGenerateAnswer) {
                jsonInstructions += `${baseAnswerJson}
- "text": The question text.
- "answer": A concise and correct answer to the question.`;
            } else {
                jsonInstructions += `
Each object in the "questions" array must have one required field: "text". Do not include an "answer" field.`;
            }
        break;
    }
    
    const existingQuestionTexts = existingQuestions.map(q => `- ${q.text}`).join('\n');

    const prompt = `
        You are an expert biology teacher. Generate ${criteria.count} unique questions in ${targetLanguage}.
        Criteria:
        - Class: ${criteria.class}, Chapter: "${criteria.chapter}", Marks: ${criteria.marks}, Difficulty: ${criteria.difficulty}
        - ${getStyleGuideline(criteria.questionType)}
        - ${formatInstructions}
        ${criteria.keywords ? `Incorporate keywords: ${criteria.keywords}.` : ''}
        
        Do NOT repeat these existing questions:
        ${existingQuestionTexts || "None"}

        Output Format:
        ${jsonInstructions.trim()}
    `;
    
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return { generatedQuestions: result.questions || [] };
};

export const analyzeTestAttemptOpenAI = async (
  questions: Question[],
  studentAnswers: StudentAnswer[],
  lang: Language,
  openAIApiKey: string,
  signal?: AbortSignal,
): Promise<Analysis> => {
    const detailedAttempt = questions.map(q => {
        const studentAns = studentAnswers.find(sa => sa.questionId === q.id)?.answer || "Not Answered";
        const isCorrect = q.answer && studentAns.trim().toLowerCase() === q.answer.trim().toLowerCase();
        return `Question: ${q.text}\nChapter: ${q.chapter}\nCorrect Answer: ${q.answer}\nStudent's Answer: ${studentAns}\nResult: ${isCorrect ? 'Correct' : 'Incorrect'}\n---`;
    }).join('\n');
    
    const prompt = `You are a helpful biology tutor. Analyze a student's test performance in ${languageMap[lang]}.
    
    Test Data:
    ${detailedAttempt}
    
    Provide a concise analysis as a JSON object with three keys: "strengths", "weaknesses", and "summary".
    - "strengths": An array of 2-3 strings describing specific strengths.
    - "weaknesses": An array of 2-3 strings describing areas for improvement.
    - "summary": A brief (1-2 sentences) overall summary.
    
    Return ONLY a single valid JSON object.
    `;
    return await openAIChatCompletion(openAIApiKey, prompt, true, null, signal) as Analysis;
};

export const generateFlashcardsAIOpenAI = async (
  chapter: string,
  classNum: number,
  count: number,
  lang: Language,
  openAIApiKey: string,
  signal?: AbortSignal,
): Promise<Flashcard[]> => {
    const prompt = `You are a biology teacher creating study flashcards.
    Generate ${count} flashcards for the topic "${chapter}" for Class ${classNum} in ${languageMap[lang]}.
    Focus on key terms, definitions, and important concepts.

    Output a valid JSON object with a single key "flashcards", which is an array of objects. Each object must have a "question" and "answer" key.
    `;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.flashcards || [];
};

export const extractQuestionsFromImageAIOpenAI = async (
  imageDataUrl: string,
  classNum: number,
  lang: Language,
  openAIApiKey: string,
  signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    const prompt = `
        You are an expert at analyzing images of exam papers. Extract all questions from the provided image.
        For each question, identify its text. Try to infer the marks if they are mentioned near the question.
        The content must be in the ${languageMap[lang]} language.
        Return the result as a valid JSON object with a single key "questions". The value should be an array of objects, where each object has a "text" field (string) and an optional "marks" field (number).
    `;
    const visionContent = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } }
    ];
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, visionContent, signal);
    return result.questions || [];
};

export const extractQuestionsFromPdfAIOpenAI = async (
    pdfDataUrl: string,
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    // OpenAI's Chat Completions API doesn't directly support base64 PDF uploads in the same way Gemini does.
    // This would require a third-party library or a more complex implementation.
    // For now, we explicitly state it's not supported to avoid silent failures.
    throw new Error("PDF question extraction is not supported via the OpenAI fallback at this time.");
};

export const suggestDiagramsAIOpenAI = async (
  chapter: string,
  classNum: number,
  lang: Language,
  openAIApiKey: string,
  signal?: AbortSignal,
): Promise<DiagramSuggestion[]> => {
    const prompt = `
        List the 3 most important diagrams for a Class ${classNum} student studying "${chapter}".
        For each diagram, provide its name, a brief description, and a detailed prompt for an image generation AI.
        The content must be in ${languageMap[lang]}.
        Return a valid JSON object with a key "diagrams", containing an array of objects. Each object must have "name", "description", and "image_prompt" keys.
    `;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.diagrams || [];
};

export const gradeDiagramAIOpenAI = async (
    referenceImagePrompt: string,
    studentDrawingDataUrl: string,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal,
): Promise<DiagramGrade> => {
    const referenceImageBase64 = await openAIImageGeneration(openAIApiKey, referenceImagePrompt, signal);
    const referenceImageUrl = `data:image/png;base64,${referenceImageBase64}`;

    const prompt = `
        You are an expert biology teacher grading a student's diagram.
        The first image is the correct reference diagram. The second is the student's drawing.
        Evaluate the student's drawing on accuracy, labeling, and neatness.
        Provide constructive feedback in ${languageMap[lang]}.
        Return a single valid JSON object with "score" (number out of 10), "strengths" (array of strings), "areasForImprovement" (array of strings), and "feedback" (a summary string).
    `;
    const visionContent = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: referenceImageUrl } },
        { type: 'image_url', image_url: { url: studentDrawingDataUrl } }
    ];
    return await openAIChatCompletion(openAIApiKey, prompt, true, visionContent, signal) as DiagramGrade;
};

export const answerDoubtAIOpenAI = async (
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    text?: string,
    imageDataUrl?: string,
    signal?: AbortSignal,
): Promise<string> => {
    const prompt = `
        You are a friendly biology tutor for a Class ${classNum} student.
        A student has a doubt. Explain the concept clearly and concisely in ${languageMap[lang]}.
        If it's a question, guide them step-by-step. Use Markdown for formatting.
        The student's doubt is: ${text || 'Please analyze the attached image.'}
    `;
    const visionContent: any[] = [{ type: 'text', text: prompt }];
    if (imageDataUrl) {
        visionContent.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }
    return await openAIChatCompletion(openAIApiKey, prompt, false, visionContent, signal) as string;
};

export const answerTeacherDoubtAIOpenAI = async (
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    text?: string,
    imageDataUrl?: string,
    signal?: AbortSignal,
): Promise<string> => {
    const prompt = `
        You are an expert biology teaching assistant for a Class ${classNum} teacher.
        A teacher has a query. Provide a clear, detailed, and pedagogically sound explanation suitable for a teacher. Use Markdown for formatting.
        The content must be in ${languageMap[lang]}.
        The teacher's query is: ${text || 'Please analyze the attached image.'}
    `;
    const visionContent: any[] = [{ type: 'text', text: prompt }];
    if (imageDataUrl) {
        visionContent.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    }
    return await openAIChatCompletion(openAIApiKey, prompt, false, visionContent, signal) as string;
};

export const generateStudyGuideAIOpenAI = async (
    chapter: string,
    classNum: number,
    topic: string,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal,
): Promise<string> => {
    const prompt = `
        You are a biology teacher creating a concise study guide for a Class ${classNum} student.
        Generate a list of all important "${topic}" from the chapter "${chapter}".
        The output should be clear, well-structured in Markdown format, and in the ${languageMap[lang]} language.
    `;
    return await openAIChatCompletion(openAIApiKey, prompt, false, null, signal) as string;
};

export const suggestPracticeSetsAIOpenAI = async (
    attempts: TestAttempt[],
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal,
): Promise<PracticeSuggestion[]> => {
    const weaknesses = attempts
        .flatMap(a => a.analysis?.weaknesses || [])
        .filter((value, index, self) => self.indexOf(value) === index);

    if (weaknesses.length === 0) return [];
    
    const prompt = `
        You are an expert biology tutor. A Class ${classNum} student has these weaknesses:
        - ${weaknesses.join('\n- ')}

        Based *only* on these weaknesses, suggest up to 3 specific practice topics.
        The response must be in ${languageMap[lang]}.
        Return a valid JSON object with a key "suggestions", containing an array of objects. Each object must have "chapter", "topic", and "reason" keys.
    `;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.suggestions || [];
};

// FIX: Add the new function to serve as a fallback for text extraction.
export const extractQuestionsFromTextAIOpenAI = async (
    text: string,
    classNum: number,
    lang: Language,
    openAIApiKey: string,
    signal?: AbortSignal
): Promise<Partial<Question>[]> => {
    const prompt = `
        You are an expert at analyzing text from exam papers. Extract all questions from the provided text.
        For each question, identify its text. Try to infer the marks if they are mentioned near the question.
        The content must be in the ${languageMap[lang]} language.
        Return the result as a valid JSON object with a single key "questions". The value should be an array of objects, where each object has a "text" field (string) and an optional "marks" field (number).
        
        The text to analyze is:
        ---
        ${text}
        ---
    `;
    const result = await openAIChatCompletion(openAIApiKey, prompt, true, null, signal);
    return result.questions || [];
};