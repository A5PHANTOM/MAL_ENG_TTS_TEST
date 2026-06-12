import os
import sys
import asyncio
from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.services.groq.llm import GroqLLMService
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCRequestHandler, 
    SmallWebRTCRequest,
    SmallWebRTCPatchRequest,
    IceCandidate
)
from pipecat.transports.base_transport import TransportParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.worker import PipelineWorker, PipelineParams
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMUserAggregator, LLMAssistantAggregator
from pipecat.frames.frames import StartFrame, LLMContextFrame
from loguru import logger

load_dotenv(override=True)

# Logging configuration
logger.remove()
logger.add(sys.stderr, level="DEBUG")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Load API keys
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not SARVAM_API_KEY or not GROQ_API_KEY:
    logger.warning("SARVAM_API_KEY or GROQ_API_KEY is missing!")

# Initialize WebRTC request handler
webrtc_handler = SmallWebRTCRequestHandler()

async def start_bot(transport: SmallWebRTCTransport):
    # 2. Setup Sarvam STT (Malayalam + English)
    stt = SarvamSTTService(
        api_key=SARVAM_API_KEY,
        settings=SarvamSTTService.Settings(model="saaras:v3")
    )

    # 3. Setup LLM (Groq for low latency)
    llm = GroqLLMService(
        api_key=GROQ_API_KEY,
        settings=GroqLLMService.Settings(model="llama-3.3-70b-versatile")
    )

    # 4. Setup Sarvam TTS (Natural Malayalam/English voices)
    tts = SarvamTTSService(
        api_key=SARVAM_API_KEY,
        settings=SarvamTTSService.Settings(
            voice="ritu", # Good for Malayalam/English
            model="bulbul:v3"
        )
    )

    # 5. Conversation Context
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful AI personal assistant. "
                "You can speak both Malayalam and English. "
                "Always respond in the language the user is speaking. "
                "If the user speaks Malayalam, respond in Malayalam. "
                "If the user speaks English, respond in English. "
                "Keep responses concise and helpful."
            )
        }
    ]
    context = LLMContext(messages=messages)
    user_aggregator = LLMUserAggregator(context)
    assistant_aggregator = LLMAssistantAggregator(context)

    # 6. Build Pipeline
    pipeline = Pipeline([
        transport.input(),
        stt,
        user_aggregator,
        llm,
        assistant_aggregator,
        tts,
        transport.output()
    ])

    # 7. Run Task
    runner = WorkerRunner()
    task = PipelineWorker(
        pipeline, 
        params=PipelineParams(allow_interruptions=True)
    )
    
    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        await task.cancel()

    # In Pipecat 1.3.0, use the StartFrame to initialize the pipeline
    # and LLMContextFrame to provide the initial context.
    await task.queue_frames([
        StartFrame(),
        LLMContextFrame(context=context)
    ])
    
    await runner.add_workers(task)
    await runner.run()

@app.post("/")
@app.post("/offer")
async def webrtc_offer(request: Request):
    try:
        body = await request.body()
        if not body:
            logger.error("Received empty request body in /offer")
            raise HTTPException(status_code=400, detail="Empty request body")
        
        data = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse JSON request in /offer: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    sdp = data.get("sdp")
    type = data.get("type")
    
    if not sdp or not type:
        raise HTTPException(status_code=400, detail="Invalid WebRTC offer")
    
    async def webrtc_connection_callback(webrtc_connection):
        transport = SmallWebRTCTransport(
            webrtc_connection=webrtc_connection,
            params=TransportParams(
                audio_out_enabled=True,
                audio_in_enabled=True,
            )
        )
        # Run the bot in the background
        asyncio.create_task(start_bot(transport))
    
    # Process the offer and get the answer
    webrtc_request = SmallWebRTCRequest(sdp=sdp, type=type)
    answer = await webrtc_handler.handle_web_request(webrtc_request, webrtc_connection_callback)
    
    return answer

@app.patch("/offer")
async def webrtc_patch(request: Request):
    try:
        data = await request.json()
        pc_id = data.get("pc_id")
        candidates_data = data.get("candidates", [])
        
        # Manually parse candidates to avoid AttributeError in request_handler
        candidates = []
        for c in candidates_data:
            candidates.append(IceCandidate(
                candidate=c.get("candidate"),
                sdp_mid=c.get("sdp_mid") or c.get("sdpMid"),
                sdp_mline_index=c.get("sdp_mline_index") or c.get("sdpMLineIndex")
            ))
            
        patch_request = SmallWebRTCPatchRequest(pc_id=pc_id, candidates=candidates)
        await webrtc_handler.handle_patch_request(patch_request)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error in webrtc_patch: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)




