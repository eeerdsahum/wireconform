import { heyApiAdapter } from './hey-api.js';
import { openApiGeneratorAdapter } from './openapi-generator.js';

export const adapters = [heyApiAdapter, openApiGeneratorAdapter] as const;

export const findAdapter = (adapterId: string) => adapters.find((adapter) => adapter.id === adapterId);
