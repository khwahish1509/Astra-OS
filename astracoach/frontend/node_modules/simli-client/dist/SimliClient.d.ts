interface SimliClientConfig {
    apiKey: string | "";
    faceID: string;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    session_token: string | "";
    videoRef: HTMLVideoElement;
    audioRef: HTMLAudioElement;
    enableConsoleLogs?: boolean;
    SimliURL: string | "";
    maxRetryAttempts: number | 100;
    retryDelay_ms: number | 2000;
    videoReceivedTimeout: number | 15000;
    enableSFU: boolean | true;
    model: "fasttalk" | "artalk" | "";
}
interface SimliSessionRequest {
    faceId: string;
    isJPG: boolean;
    apiKey: string;
    syncAudio: boolean;
    handleSilence: boolean;
    maxSessionLength: number;
    maxIdleTime: number;
    model: "fasttalk" | "artalk";
}
interface SimliSessionToken {
    session_token: string;
}
interface SimliClientEvents {
    connected: () => void;
    disconnected: () => void;
    failed: (reason: string) => void;
    speaking: () => void;
    silent: () => void;
}
declare class SimliClient {
    private pc;
    private dc;
    private dcInterval;
    private candidateCount;
    private prevCandidateCount;
    private apiKey;
    private session_token;
    private faceID;
    private handleSilence;
    private videoRef;
    private audioRef;
    private errorReason;
    private sessionInitialized;
    private inputStreamTrack;
    private sourceNode;
    private audioWorklet;
    private audioBuffer;
    private answer;
    private localDescription;
    private maxSessionLength;
    private maxIdleTime;
    private model;
    private pingSendTimes;
    private webSocket;
    private lastSendTime;
    private MAX_RETRY_ATTEMPTS;
    private RETRY_DELAY;
    private VIDEO_TIMEOUT;
    private connectionTimeout;
    private readonly CONNECTION_TIMEOUT_MS;
    private SimliURL;
    private enableSFU;
    isAvatarSpeaking: boolean;
    enableConsoleLogs: boolean;
    private events;
    private retryAttempt;
    private inputIceServers;
    private videoReceived;
    config: SimliClientConfig | null;
    on<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    off<K extends keyof SimliClientEvents>(event: K, callback: SimliClientEvents[K]): void;
    private emit;
    Initialize(config: SimliClientConfig): void;
    getIceServers(apiKey: string, SimliURL: string, attempt?: number): Promise<RTCIceServer[]>;
    private createPeerConnection;
    private setupPeerConnectionListeners;
    private setupConnectionStateHandler;
    start(iceServers?: RTCIceServer[], retryAttempt?: number): Promise<void>;
    private setupDataChannelListeners;
    private startDataChannelInterval;
    private stopDataChannelInterval;
    private sendPingMessage;
    createSessionToken(SimliURL: string, metadata: SimliSessionRequest): Promise<SimliSessionToken>;
    private sendSessionToken;
    private negotiate;
    private waitForIceGathering;
    private handleConnectionFailure;
    private handleConnectionTimeout;
    private handleDisconnection;
    private cleanup;
    private clearTimeouts;
    listenToMediastreamTrack(stream: MediaStreamTrack): void;
    private initializeAudioWorklet;
    sendAudioData(audioData: Uint8Array): void;
    sendAudioDataImmediate(audioData: Uint8Array): void;
    close(): void;
    ClearBuffer: () => void;
    isConnected(): boolean;
    getConnectionStatus(): {
        sessionInitialized: boolean;
        webSocketState: number | null;
        peerConnectionState: RTCPeerConnectionState | null;
        errorReason: string | null;
    };
    private setupWebSocketListeners;
}
export { SimliClient, SimliClientConfig, SimliClientEvents };
