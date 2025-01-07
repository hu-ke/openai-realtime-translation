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
  const [lastItem, setLastItem] = useState<ItemType>()
  const [translations, setTranslations] = useState<
    { source: string; dest: string }[]
  >([]);
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
  const mediaElement = useRef<HTMLMediaElement | null>(null)

  const connectConversation = useCallback(async () => {
    const client = clientRef.current;
    const wavRecorder = wavRecorderRef.current;

    // Set state variables
    setIsConnected(true);
    setRealtimeEvents([]);
    setItems(client.conversation.getItems());

    // Connect to microphone
    await wavRecorder.begin(mediaElement.current);
    // Connect to realtime API
    await client.connect();
    client.sendUserMessageContent([
      {
        type: `input_text`,
        text: `Hello!`,
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

  const handlePlay = () => {
    mediaElement.current?.play()
  }

  // useEffect(() => {
  //   console.log('items>', items)
  // }, [items])

  useEffect(() => {
    // Set audio element
    mediaElement.current = document.getElementById('video') as HTMLMediaElement | null;

    // Get refs
    const client = clientRef.current;

    // Set instructions
    client.updateSession({
      instructions: instructions({ label: '🇨🇳 Chinese', text: '中文' }),
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
          // check if ID is already in translations
          if (item.id !== lastItem?.id) {
            // parse the text into JSON-compatible format
            const text = new String(item.formatted.text)
              .replaceAll('```json', '')
              .replaceAll('```', '')
              // replace all newlines with spaces
              .replaceAll('\n', ' ');
            const translationData = JSON.parse(text);
            setLastItem(item)
            if (translationData.source && translationData.dest) {
              setTranslations((prev) => [...prev, translationData]);
            }
          }
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
      <video id="video" controls style={{width: 100}}>
        <source src="/example2.mp4" type="video/mp4" />
        Your browser does not support the video tag.
      </video>
      <button onClick={handlePlay}>Play</button>
      {translations.map((translation, index) => (
        <div key={index} className="translation-row">
          <div>{translation.source}</div>
          <div>{translation.dest}</div>
        </div>
      ))}
    </div>
  );
}

export default App;

