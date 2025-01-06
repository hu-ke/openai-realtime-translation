import { RealtimeClient } from '@openai/realtime-api-beta';
import { WavRecorder, WavStreamPlayer } from './lib/wavtools/index.js';
import { useRef, useCallback, useState, useEffect } from 'react';
import { instructions } from './utils/conversation_config.js';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import './App.css'
/**
* Type for all event logs
*/
interface RealtimeEvent {
 time: string;
 source: 'client' | 'server';
 count?: number;
 event: { [key: string]: any };
}

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [items, setItems] = useState<ItemType[]>([]);
  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );
  const clientRef = useRef<RealtimeClient>(
    new RealtimeClient({
      apiKey: localStorage.getItem('apiKey') || '',
      dangerouslyAllowAPIKeyInBrowser: true,
    })
  );
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);

  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    // Set state variables
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin();
    // Connect to realtime API
    await client.connect();
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Hello!`,
        // text: `For testing purposes, I want you to list ten car brands. Number each item, e.g. "one (or whatever number you are one): the item name".`
      },
    ]);
   
    await wavRecorder.record((data) => {
      return client.appendInputAudio(data.mono)
    });
  }, []);

  const disconnectConversation = useCallback(async () => {
    setIsConnected(false);
    setRealtimeEvents([]);
    setItems([]);

    const client = clientRef.current;
    client.disconnect();

    const wavRecorder = wavRecorderRef.current;
    await wavRecorder.end();
  }, []);

  useEffect(() => {
    console.log('items>', items)
  }, [items])

  useEffect(() => {
    // Get refs
    const client = clientRef.current;

    // Set instructions
    client.updateSession({
      instructions: instructions({ label: 'Chinese', text: '中文' }),
    });
    // Set transcription, otherwise we don't get user transcriptions back
    // client.updateSession({ input_audio_transcription: { model: 'whisper-1' } });
    client.updateSession({ modalities: ['text'] });

    client.updateSession({
      turn_detection: {
        type: 'server_vad'
      }
    })

    // handle realtime events from client + server for event logging
    client.on('realtime.event', (realtimeEvent: RealtimeEvent) => {
      setRealtimeEvents((realtimeEvents) => {
        const lastEvent = realtimeEvents[realtimeEvents.length - 1];
        if (lastEvent?.event.type === realtimeEvent.event.type) {
          // if we receive multiple events in a row, aggregate them for display purposes
          lastEvent.count = (lastEvent.count || 0) + 1;
          return realtimeEvents.slice(0, -1).concat(lastEvent);
        } else {
          return realtimeEvents.concat(realtimeEvent);
        }
      });
    });
    client.on('error', (event: any) => console.error(event));
    client.on('conversation.interrupted', async () => {
      console.log('conversation interrupted');
    });
    client.on('conversation.updated', async ({ item, delta }: any) => {
      const items = client.conversation.getItems();
      if (item.status === 'completed' && item.formatted.audio?.length) {
        const wavFile = await WavRecorder.decode(
          item.formatted.audio,
          24000,
          24000
        );
        item.formatted.file = wavFile;
      }
      setItems(items);

      if (item.role === 'assistant' && item.formatted.text) {
        try {
          console.log('item.formatted.text', item.formatted.text)
        } catch (error) {
          console.error('Failed to parse translation data:', error);
        }
      }
    });

    setItems(client.conversation.getItems());

    return () => {
      // cleanup; resets to defaults
      client.reset();
    };
  }, [])

  
  return (
    <div className="App">
      <button
        onClick={isConnected ? disconnectConversation : connectConversation}
      >
        { isConnected ? 'disconnect' : 'connect' }
      </button>
    </div>
  );
}

export default App;

