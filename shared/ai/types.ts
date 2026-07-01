export type AiMode = "rewrite" | "pro";
export type AiChannel = "email" | "linkedin";

export type JobContext = {
  personName?: string;
  personTitle?: string;
  company?: string;
  jobTitle?: string;
  category?: string;
  responsibilities?: string[];
  requiredQualifications?: string[];
  preferredQualifications?: string[];
  matchedSkills?: string[];
};

export type PersonalizeRequest = {
  mode: AiMode;
  channel: AiChannel;
  tone: string;
  text: string;
  job?: JobContext;
  resumeText?: string;
  customInstructions?: string;
  userName?: string;
};

export type PersonalizeResponse =
  | { ok: true; text: string; proofPoint?: string; cached?: boolean }
  | {
      ok: false;
      error: string;
      code?: "LIMIT_EXCEEDED" | "UNAUTHORIZED" | "VALIDATION_ERROR" | "RATE_LIMITED";
      usage?: { rewrite: number; pro: number };
      limit?: { rewrite: number; pro: number };
      upgradeUrl?: string;
    };
