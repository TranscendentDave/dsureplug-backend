import express from 'express';
import { createClient } from '@supabase/supabase-supabase-js';
import { GoogleGenAI } from '@google/generative-ai';

const app = express();
app.use(express.json());

// 1. Connect to your Supabase Database
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_KEY
);

// 2. Connect to Google AI Studio (Gemini)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 3. Define the Database Search Tool for Pluggy
const searchBusinessesTool = {
  functionDeclarations: [{
    name: 'search_businesses',
    description: 'Queries the database for registered, verified Nigerian businesses based on keywords and location.',
    parameters: {
      type: 'OBJECT',
      properties: {
        keywords: { type: 'STRING', description: 'Product or service (e.g., bone straight, laptop).' },
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

  try {
    // Start a chat session with Pluggy and give it access to our search tool
    const model = ai.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      systemInstruction: 'You are Pluggy, a friendly, street-smart AI Assistant for dSurePlug Nigeria. You must call search_businesses to find real shops.',
    });

    const chat = model.startChat({
      tools: [searchBusinessesTool]
    });

    const result = await chat.sendMessage(userMessage);
    const call = result.functionCalls?.[0];

    // If Pluggy decides it needs to search our database
    if (call && call.name === 'search_businesses') {
      const { keywords, state, city } = call.args;

      // Query our Supabase PostgreSQL database
      let query = supabase
        .from('shops')
        .select('name, category, address, city, state, is_verified')
        .textSearch('description', keywords)
        .eq('is_verified', true); // Only pull verified listings

      if (state) query = query.eq('state', state);
      if (city) query = query.eq('city', city);

      const { data: shops, error } = await query;

      if (error) throw error;

      // Send the database results back to Gemini so Pluggy can format the response nicely
      const toolResponse = await chat.sendMessage([{
        functionResponse: {
          name: 'search_businesses',
          response: { results: shops }
        }
      }]);

      return res.json({ response: toolResponse.text });
    }

    // Default conversational response if no search was needed
    res.json({ response: result.text });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong inside the backend.' });
  }
});

app.listen(3000, () => console.log('dSurePlug backend running on port 3000'));