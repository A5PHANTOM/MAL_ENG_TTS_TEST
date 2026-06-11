import { useState, useRef } from 'react';
import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import './App.css';

function App() {
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PipecatClient | null>(null);

  const connect = async () => {
    try {
      setStatus('connecting');
      setError(null);
      console.log("Starting connection process...");

      // Explicitly provide the webrtcUrl to the transport
      const transport = new SmallWebRTCTransport({
        webrtcUrl: "http://localhost:8000/offer"
      });
      
      const client = new PipecatClient({
        transport: transport,
        enableMic: true,
      });
      clientRef.current = client;

      // Listen for events
      client.on("connected", () => {
        setStatus('connected');
        console.log("Client connected event received");
      });

      client.on("disconnected", () => {
        setStatus('disconnected');
        console.log("Client disconnected event received");
      });

      client.on("error", (err) => {
        console.error("Client error event received:", err);
        setError("Connection error occurred.");
        setStatus('error');
      });

      // Connect to the backend
      console.log("Calling client.connect()...");
      await client.connect();
      console.log("client.connect() call finished");

    } catch (err) {
      console.error("Failed to connect catch block:", err);
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStatus('error');
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      console.log("Disconnecting...");
      await clientRef.current.disconnect();
      clientRef.current = null;
      setStatus('disconnected');
    }
  };

  return (
    <div className="container">
      <header>
        <h1>MAL_ENG AI Agent</h1>
        <p>Malayalam & English Bilingual Assistant</p>
      </header>

      <main>
        <div className="status-card">
          <div className={`status-indicator ${status}`}></div>
          <span>Status: {status.charAt(0).toUpperCase() + status.slice(1)}</span>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="controls">
          {status === 'disconnected' || status === 'error' ? (
            <button className="connect-btn" onClick={connect}>
              Start Conversation
            </button>
          ) : (
            <button className="disconnect-btn" onClick={disconnect}>
              Stop Conversation
            </button>
          )}
        </div>

        {status === 'connected' && (
          <div className="active-ui">
            <div className="mic-visualizer">
              {/* Add a simple visualizer here if desired */}
              <p>Listening...</p>
            </div>
            <p className="hint">Speak in Malayalam or English</p>
          </div>
        )}
      </main>

      <footer>
        <p>Powered by Pipecat, Sarvam AI & Groq</p>
      </footer>
    </div>
  );
}

export default App;
