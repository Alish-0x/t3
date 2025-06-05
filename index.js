// Cloudflare Worker: index.js

// Default CORS headers - adjust as necessary for your frontend's origin in production
const corsHeaders = {
  'Access-Control-Allow-Origin': 'tts.pulseonix.xyz', // IMPORTANT: In production, restrict this to your frontend domain
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Handles CORS preflight OPTIONS requests.
 * @param {Request} request
 * @returns {Response}
 */
async function handleOptions(request) {
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS preflight requests.
    return new Response(null, {
      headers: corsHeaders,
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        Allow: 'POST, OPTIONS',
      },
    });
  }
}

/**
 * Handles the TTS synthesis request.
 * @param {Request} request The incoming request object
 * @param {object} env The environment object (for secrets)
 * @returns {Promise<Response>}
 */
async function handleTTSRequest(request, env) {
  try {
    const requestData = await request.json();

    // 1. Input Validation
    if (!requestData.text || !requestData.text.trim()) {
      return new Response(JSON.stringify({ detail: 'Text input cannot be empty.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (requestData.text.length > 5000) { // Matching frontend limit
      return new Response(JSON.stringify({ detail: 'Text exceeds the maximum limit of 5000 characters.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (!requestData.language || requestData.language !== 'en-US') {
         // Currently, frontend sends 'en-US' but it's good to validate if more languages are ever added
        return new Response(JSON.stringify({ detail: 'Invalid or unsupported language code.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }


    // 2. Prepare request for Google Cloud Text-to-Speech API
    // IMPORTANT: You MUST set GOOGLE_TTS_API_KEY as a secret in your Cloudflare Worker settings.
    const GOOGLE_TTS_API_KEY = env.GOOGLE_TTS_API_KEY;
    if (!GOOGLE_TTS_API_KEY) {
        console.error("GOOGLE_TTS_API_KEY secret is not set in Worker environment.");
        return new Response(JSON.stringify({ detail: 'Server configuration error: TTS API key missing.' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
    const EXTERNAL_TTS_API_URL = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;

    // Map frontend voiceId and modelId to Google Cloud TTS parameters
    // This is a simplified mapping. Google's voice names are specific.
    // The `voiceId` from your frontend needs to be a valid Google Cloud TTS voice name.
    // The `modelId` ("standard" or "enhanced") might influence the choice of voice name
    // as Google's "WaveNet" or "Studio" voices are their enhanced quality.
    
    let googleVoiceName = requestData.voiceId; // Assuming frontend voiceId is a valid Google Voice name
    let audioConfig = {
        audioEncoding: "MP3", // Common, good quality and size
        // speakingRate: 1.0, // Optional
        // pitch: 0,         // Optional
    };

    // Example: If your frontend 'enhanced' model means a specific type of voice, adjust here.
    // For Google, "WaveNet" or "Studio" voices provide enhanced quality.
    // The voice name itself usually dictates the quality.
    // e.g. "en-US-Wavenet-D" or "en-US-Studio-M"
    // Your frontend's `en-US-Chirp3-HD-Autonoe` might be a direct valid Google voice name or require mapping.
    // For this example, we'll assume `requestData.voiceId` is what Google expects.
    // If `requestData.modelId === "enhanced"` and your chosen `voiceId` isn't already an enhanced voice,
    // you might select a different `googleVoiceName` known to be enhanced.
    // This logic depends heavily on the exact voice names you make available in the frontend
    // and their corresponding names in the Google TTS service.

    const ttsRequestBody = {
      input: { text: requestData.text },
      voice: {
        languageCode: requestData.language, // e.g., "en-US"
        name: googleVoiceName,
        // ssmlGender: "FEMALE" // This can be specified if the voice name isn't gender-specific.
                             // Your default `en-US-Chirp3-HD-Autonoe` implies FEMALE.
      },
      audioConfig: audioConfig
    };

    // 3. Call the External Google Cloud TTS API
    const externalTTSResponse = await fetch(EXTERNAL_TTS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ttsRequestBody),
    });

    if (!externalTTSResponse.ok) {
      const errorBody = await externalTTSResponse.text();
      console.error(`Google TTS API Error (${externalTTSResponse.status}): ${errorBody}`);
      // Try to parse Google's error structure
      let detailMessage = `External TTS service failed with status: ${externalTTSResponse.status}.`;
      try {
        const googleError = JSON.parse(errorBody);
        if (googleError.error && googleError.error.message) {
          detailMessage = `External TTS Error: ${googleError.error.message}`;
        }
      } catch(e) { /* Ignore if not JSON */ }
      
      return new Response(JSON.stringify({ detail: detailMessage }), {
        status: externalTTSResponse.status, // Propagate Google's error status if appropriate
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const ttsAudioResponseData = await externalTTSResponse.json();

    if (!ttsAudioResponseData.audioContent) {
        console.error("Google TTS API did not return audioContent in response:", ttsAudioResponseData);
        return new Response(JSON.stringify({ detail: 'Failed to get audio content from external TTS service. Response format unexpected.' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    // The `audioContent` from Google TTS is already base64 encoded.
    const audioBase64 = ttsAudioResponseData.audioContent;

    const responsePayload = {
      audioData: audioBase64,
      message: "Audio synthesized successfully.",
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error in handleTTSRequest (Cloudflare Worker):', error.stack || error.message);
    return new Response(JSON.stringify({ detail: error.message || 'Internal server error in Worker.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

// Entry point for Cloudflare Worker
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/v1/simple-tts') {
      return handleTTSRequest(request, env);
    }

    return new Response('Not Found. Use POST /api/v1/simple-tts', { status: 404 });
  }
};
