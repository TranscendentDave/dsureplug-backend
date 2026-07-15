import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(express.json());

// 1. Connect to your Supabase Database
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_KEY
);

// 2. Connect to Google AI Studio (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 3. Define the Database Search Tool for Pluggy
const searchBusinessesTool = {
  functionDeclarations: [{
    name: 'search_businesses',
    description: 'Queries the database for registered, verified Nigerian businesses based on keywords and location.',
    parameters: {
      type: 'OBJECT',
      properties: {
        keywords: { type: 'STRING', description: 'Product, service, or category (e.g., hair, electronics, laptop).' },
        state: { type: 'STRING', description: 'Nigerian state (e.g., Lagos, Abuja).' },
        city: { type: 'STRING', description: 'Local area or market (e.g., Ikeja, Wuse).' }
      },
      required: ['keywords']
    }
  }]
};

// 4. Handle Chat Search Requests from your App
app.post('/api/chat', async (req, res) => {
  const { userMessage } = req.body;

  if (!userMessage) {
    return res.status(400).json({ error: 'userMessage is required.' });
  }

  try {
    // Correct tool registration at the model configuration level
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: 'You are Pluggy, a friendly, street-smart AI Assistant for dSurePlug Nigeria. You must call search_businesses to find real shops for the user.',
      tools: [searchBusinessesTool] 
    });

    const chat = model.startChat();
    const result = await chat.sendMessage(userMessage);
    
    // Correctly call functionCalls as a method using parentheses
    const functionCalls = result.response.functionCalls();

    // If Gemini decides it needs to search our database
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];

      if (call.name === 'search_businesses') {
        const { keywords, state, city } = call.args;

        // Query Supabase: Matches keywords against business_name OR category
        let query = supabase
          .from('shops')
          .select('business_name, category, physical_address, city, state, is_verified')
          .or(`business_name.ilike.%${keywords}%,category.ilike.%${keywords}%`);

        if (state) query = query.eq('state', state);
        if (city) query = query.eq('city', city);

        const { data: shops, error } = await query;

        if (error) throw error;

        // Send the database results back to Gemini so Pluggy can format the response nicely
        const toolResponse = await chat.sendMessage([{
          functionResponse: {
            name: 'search_businesses',
            response: { results: shops || [] }
          }
        }]);

        return res.json({ response: toolResponse.response.text() });
      }
    }

    // Default conversational response if no search was needed
    res.json({ response: result.response.text() });

  } catch (error) {
    console.error('Error during processing:', error);
    res.status(500).json({ error: 'Something went wrong inside the backend.' });
  }
});

// Use Render's dynamic port or default to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`dSurePlug backend running on port ${PORT}`));
