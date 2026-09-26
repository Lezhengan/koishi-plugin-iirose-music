import type { Console } from '@koishijs/plugin-console';
import { Context, Schema } from 'koishi';
declare module 'koishi' {
    interface Context {
        console: Console;
    }
}
declare module '@koishijs/plugin-console' {
    interface Events {
        'iirose-music/get-qrcode'(): Promise<{
            unikey: string;
            qrcode: string;
        }>;
        'iirose-music/check-login'(unikey: string): Promise<{
            code: number;
            message: string;
            cookie?: string;
        }>;
    }
}
export declare const name = "iirose-music";
export type Quality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires' | 'sky' | 'jyeffect' | 'jymaster';
export interface Config {
    apiBase: string;
    quality: Quality;
    cookie: string;
    login: string;
    commandHead: string;
    musicHot: boolean;
    hotCommentLimit: number;
    botTable: {
        botId?: string;
        roomId?: string;
    }[];
    debug: boolean;
    randomCNIP: boolean;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
