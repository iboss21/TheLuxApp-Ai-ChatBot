import { logger } from '../utils/logger';

export interface SafetyCheckResult {
  safe: boolean;
  flags: {
    injection: boolean;
    pii: boolean;
    dlp: boolean;
    toxicity: boolean;
  };
  redactedContent?: string;
  reason?: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /system\s*prompt/i,
  /jailbreak/i,
  /you\s+are\s+now\s+DAN/i,
  /forget\s+your\s+(instructions|training)/i,
];

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[SSN REDACTED]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g, replacement: '[CARD REDACTED]' },
  { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '[EMAIL REDACTED]' },
  { name: 'phone', pattern: /\b(?:\+1[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '[PHONE REDACTED]' },
];

const DISALLOWED_TOPICS = [
  /\b(how\s+to\s+make\s+a\s+bomb|weapons\s+manufacturing)\b/i,
  /\bself.?harm\b/i,
  /\billegal\s+drugs\b/i,
];

export class SafetyService {
  checkInput(content: string): SafetyCheckResult {
    const flags = { injection: false, pii: false, dlp: false, toxicity: false };

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(content)) {
        flags.injection = true;
        logger.warn({ content: content.slice(0, 100) }, 'Injection attempt detected');
        break;
      }
    }

    for (const topic of DISALLOWED_TOPICS) {
      if (topic.test(content)) {
        flags.toxicity = true;
        break;
      }
    }

    const hasPii = PII_PATTERNS.some(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(content);
    });
    if (hasPii) flags.pii = true;

    const safe = !flags.injection && !flags.toxicity;
    return {
      safe,
      flags,
      reason: flags.injection ? 'Prompt injection detected' :
              flags.toxicity ? 'Disallowed topic detected' : undefined,
    };
  }

  redactPii(content: string): string {
    let redacted = content;
    for (const { pattern, replacement } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, replacement);
    }
    return redacted;
  }

  checkOutput(content: string): SafetyCheckResult {
    const flags = { injection: false, pii: false, dlp: false, toxicity: false };
    let redactedContent = content;

    const hasPii = PII_PATTERNS.some(({ pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(content);
    });
    if (hasPii) {
      flags.pii = true;
      redactedContent = this.redactPii(content);
    }

    return { safe: true, flags, redactedContent };
  }
}

export const safetyService = new SafetyService();
