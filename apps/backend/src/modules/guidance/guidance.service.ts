import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { AbcStep, GuidanceResponse } from "@events/contracts";

/** Static ABC reference, used as the fallback when no AI is configured. */
const STATIC_ABC: Record<AbcStep, { instruction: string; note: string }> = {
  A: {
    instruction:
      "Tilt the head back gently and lift the chin. Check the mouth is clear of any obstruction.",
    note: "Airway first — nothing else matters until the airway is open.",
  },
  B: {
    instruction:
      "Look, listen, and feel for breathing for up to 10 seconds. If there is none, prepare to give rescue breaths.",
    note: "Watch the chest rise and fall.",
  },
  C: {
    instruction:
      "Press firmly on the centre of the chest — hard and fast, 100–120 beats per minute. Don't stop until help arrives.",
    note: "Push to the beat of a fast song; allow full chest recoil between compressions.",
  },
};

@Injectable()
export class GuidanceService {
  private readonly logger = new Logger(GuidanceService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  /** Decide the current ABC step + plain-language instruction from a transcript. */
  async guide(transcript: string, category?: string): Promise<GuidanceResponse> {
    if (this.client && transcript.trim()) {
      try {
        return await this.askClaude(transcript, category);
      } catch (err) {
        this.logger.warn(`Guidance AI failed, using static fallback: ${String(err)}`);
      }
    }
    return this.staticStep(transcript);
  }

  /** Heuristic step pick for the offline / no-AI path. */
  private staticStep(transcript: string): GuidanceResponse {
    const t = transcript.toLowerCase();
    let step: AbcStep = "A";
    if (/breath|breathing|chest|cpr|pump|compress|unrespons|not moving|no pulse/.test(t)) {
      step = /compress|cpr|pump|no pulse|pulseless/.test(t) ? "C" : "B";
    }
    return { currentStep: step, ...STATIC_ABC[step] };
  }

  private async askClaude(transcript: string, category?: string): Promise<GuidanceResponse> {
    const system =
      "You are a calm emergency first-aid coach guiding a fatigued, possibly panicking bystander " +
      "at a remote trail race through the medical ABCs (Airway, Breathing, Circulation) while a " +
      "medic is en route. Decide which single ABC step the person should focus on RIGHT NOW based " +
      "on what they describe. Keep the instruction to one or two short, literal sentences a stressed " +
      "person can follow, and never give advice beyond basic ABC first aid. " +
      'Reply with ONLY a JSON object of the form {"currentStep":"A"|"B"|"C","instruction":string,"note":string} — no prose, no markdown.';

    const message = await this.client!.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: `Incident category: ${category ?? "unknown"}\nWhat the bystander said: "${transcript}"`,
        },
      ],
    });

    const text = message.content.find((b) => b.type === "text");
    if (text && "text" in text) {
      const json = text.text.slice(text.text.indexOf("{"), text.text.lastIndexOf("}") + 1);
      const parsed = JSON.parse(json) as GuidanceResponse;
      if (parsed.currentStep && parsed.instruction) return parsed;
    }
    return this.staticStep(transcript);
  }
}
