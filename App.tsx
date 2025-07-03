
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chat } from '@google/genai';
import {
    ChatMessage,
    AppStatus,
    SpeechRecognition,
    SpeechRecognitionStatic,
    SpeechRecognitionEvent,
    SpeechRecognitionErrorEvent
} from './types';
import { createChatSession, sendMessageToGemini } from './services/geminiService';

const MicrophoneIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM17 13a1 1 0 0 1-1 1c-2.21 0-4 1.79-4 4v1a1 1 0 0 1-2 0v-1c0-3.31 2.69-6 6-6a1 1 0 0 1 1 1Z"/>
    </svg>
);

const StopIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 6h12v12H6z"/>
    </svg>
);

const SpeakerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
);

const LoadingSpinner: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
        <defs>
            <linearGradient id="spinner-gradient">
                <stop offset="0%" stopColor="#4F46E5" stopOpacity="0"/>
                <stop offset="100%" stopColor="#4F46E5" stopOpacity="1"/>
            </linearGradient>
        </defs>
        <path stroke="url(#spinner-gradient)" strokeWidth="20" d="M100 10 a 90 90 0 0 1 0 180 a 90 90 0 0 1 0 -180" strokeLinecap="round"/>
    </svg>
);

const ChatBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
    const isAssistant = message.role === 'assistant';
    return (
        <div className={`flex items-start gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
            {isAssistant && (
                <div className="w-8 h-8 rounded-full bg-indigo-500 flex-shrink-0 flex items-center justify-center text-white font-bold">B</div>
            )}
            <div className={`max-w-xl p-4 rounded-2xl ${isAssistant ? 'bg-white dark:bg-gray-700 rounded-tl-none' : 'bg-indigo-500 text-white rounded-br-none'}`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.text}</p>
            </div>
        </div>
    );
};


const App: React.FC = () => {
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [conversation, setConversation] = useState<ChatMessage[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [transcript, setTranscript] = useState('');

    const chatSessionRef = useRef<Chat | null>(null);
    const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const selectedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
    const finalTranscriptRef = useRef('');

    const speak = useCallback((text: string) => {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        
        // Nettoie le texte pour supprimer les caractères de démarquage comme les astérisques pour une expérience vocale plus fluide.
        const cleanedText = text.replace(/\*/g, '');

        setStatus(AppStatus.SPEAKING);
        const utterance = new SpeechSynthesisUtterance(cleanedText);
        utterance.lang = 'fr-FR';
        utterance.rate = 1.05;
        utterance.pitch = 0.9;

        if (selectedVoiceRef.current) {
            utterance.voice = selectedVoiceRef.current;
        }

        utterance.onend = () => {
            setStatus(AppStatus.IDLE);
        };
        utterance.onerror = (e) => {
            console.error("Speech synthesis error", e);
            setError("Désolé, une erreur de synthèse vocale est survenue.");
            setStatus(AppStatus.ERROR);
        };
        window.speechSynthesis.speak(utterance);
    }, []);

    const processUserMessage = useCallback(async (text: string) => {
        if (!text.trim()) {
            setStatus(AppStatus.IDLE);
            return;
        }
        setConversation(prev => [...prev, { role: 'user', text }]);
        setStatus(AppStatus.THINKING);

        if (!chatSessionRef.current) {
            setError("La session de chat n'est pas initialisée.");
            setStatus(AppStatus.ERROR);
            return;
        }

        const assistantResponse = await sendMessageToGemini(chatSessionRef.current, text);
        setConversation(prev => [...prev, { role: 'assistant', text: assistantResponse }]);
        speak(assistantResponse);
    }, [speak]);
    
    const initialize = useCallback(async () => {
        try {
            const SpeechRecognitionAPI: SpeechRecognitionStatic | undefined =
                (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            
            if (!SpeechRecognitionAPI) {
                throw new Error("L'API de reconnaissance vocale n'est pas supportée par ce navigateur.");
            }
            speechRecognitionRef.current = new SpeechRecognitionAPI();
            speechRecognitionRef.current.continuous = true;
            speechRecognitionRef.current.lang = 'fr-FR';
            speechRecognitionRef.current.interimResults = true;

            speechRecognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
                let interimTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcriptPiece = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscriptRef.current += transcriptPiece + ' ';
                    } else {
                        interimTranscript += transcriptPiece;
                    }
                }
                setTranscript(finalTranscriptRef.current + interimTranscript);
            };
            speechRecognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
                console.error('Speech recognition error:', event.error);
                let errorMessage = "Une erreur de reconnaissance vocale est survenue.";
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    errorMessage = "L'accès au microphone est refusé. Veuillez l'autoriser dans les paramètres de votre navigateur.";
                }
                setError(errorMessage);
                setStatus(AppStatus.ERROR);
            };
            
            chatSessionRef.current = createChatSession();
            setStatus(AppStatus.THINKING);
            const initialMessage = await sendMessageToGemini(chatSessionRef.current, "Bonjour, présente-toi.");
            setConversation([{ role: 'assistant', text: initialMessage }]);
            speak(initialMessage);

        } catch (e: any) {
            console.error("Initialization failed:", e);
            setError(e.message || "Erreur d'initialisation. Vérifiez la console.");
            setStatus(AppStatus.ERROR);
        }
    }, [speak]);

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length === 0) return;
            
            const frenchVoice =
                voices.find(v => v.lang === 'fr-FR' && v.name.includes('Google')) ||
                voices.find(v => v.lang === 'fr-FR' && v.name.includes('Aurelie')) ||
                voices.find(v => v.lang === 'fr-FR' && (v.name.includes('Female') || v.name.includes('Femme'))) ||
                voices.find(v => v.lang === 'fr-FR' && v.default) ||
                voices.find(v => v.lang === 'fr-FR');
            
            selectedVoiceRef.current = frenchVoice || null;
        };
        
        window.speechSynthesis.onvoiceschanged = loadVoices;
        loadVoices();

        initialize();
        return () => {
            window.speechSynthesis?.cancel();
            speechRecognitionRef.current?.stop();
            window.speechSynthesis.onvoiceschanged = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialize]);

    useEffect(() => {
        if (!speechRecognitionRef.current) return;
        // This onend handler is for when the recognition service itself stops
        const handleRecognitionEnd = () => {
            // Only process if we were intentionally listening
            if (status === AppStatus.LISTENING) {
                // The stop() was called, so process the final transcript.
                 processUserMessage(finalTranscriptRef.current.trim());
                 finalTranscriptRef.current = '';
                 setTranscript('');
            }
        };
        speechRecognitionRef.current.onend = handleRecognitionEnd;
    }, [status, processUserMessage]);

    useEffect(() => {
        chatContainerRef.current?.scrollTo({
            top: chatContainerRef.current.scrollHeight,
            behavior: 'smooth'
        });
    }, [conversation]);

    const handleMicClick = () => {
        setError(null);

        if (status === AppStatus.SPEAKING) {
            window.speechSynthesis.cancel();
            setStatus(AppStatus.IDLE);
            return;
        }

        if (status === AppStatus.LISTENING) {
            speechRecognitionRef.current?.stop();
            // onend will handle the rest
        } else {
            finalTranscriptRef.current = '';
            setTranscript('');
            speechRecognitionRef.current?.start();
            setStatus(AppStatus.LISTENING);
        }
    };
    
    const getButtonContent = () => {
        switch (status) {
            case AppStatus.LISTENING:
                return {
                    icon: <StopIcon className="w-8 h-8 text-white"/>,
                    text: 'Appuyez pour arrêter',
                    color: 'bg-red-500 hover:bg-red-600 animate-pulse'
                };
            case AppStatus.THINKING:
                return {
                    icon: <LoadingSpinner className="w-8 h-8 animate-spin"/>,
                    text: 'Réflexion...',
                    color: 'bg-gray-500 cursor-not-allowed'
                };
            case AppStatus.SPEAKING:
                return {
                    icon: <SpeakerIcon className="w-8 h-8 text-white"/>,
                    text: 'En train de parler...',
                    color: 'bg-yellow-500 hover:bg-yellow-600'
                };
            case AppStatus.ERROR:
                 return {
                    icon: <MicrophoneIcon className="w-8 h-8 text-white"/>,
                    text: 'Réessayer',
                    color: 'bg-red-500 hover:bg-red-600'
                };
            case AppStatus.IDLE:
            default:
                return {
                    icon: <MicrophoneIcon className="w-8 h-8 text-white"/>,
                    text: 'Appuyez pour parler',
                    color: 'bg-indigo-600 hover:bg-indigo-700'
                };
        }
    };
    
    const buttonContent = getButtonContent();

    return (
        <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <header className="p-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm text-center">
                <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">Assistant Biologie</h1>
            </header>
            
            <main ref={chatContainerRef} className="flex-1 p-6 space-y-6 overflow-y-auto">
                {conversation.map((msg, index) => (
                    <ChatBubble key={index} message={msg} />
                ))}
            </main>

            <footer className="p-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700">
                {error && <div className="text-center text-red-500 dark:text-red-400 mb-2 text-sm">{error}</div>}
                
                {status === AppStatus.LISTENING && (
                    <div className="w-full max-w-2xl mx-auto mb-3 px-4">
                        <div className="text-center text-gray-700 dark:text-gray-300 p-3 bg-gray-200 dark:bg-gray-700/50 rounded-lg min-h-[48px] flex items-center justify-center">
                            <p className="italic">{transcript || "Je vous écoute..."}</p>
                        </div>
                    </div>
                )}
                
                <div className="flex flex-col items-center justify-center gap-3">
                     <button
                        onClick={handleMicClick}
                        disabled={status === AppStatus.THINKING}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg focus:outline-none focus:ring-4 focus:ring-indigo-500/50 ${buttonContent.color}`}
                    >
                        {buttonContent.icon}
                    </button>
                    <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">{buttonContent.text}</p>
                </div>
            </footer>
        </div>
    );
};

export default App;
