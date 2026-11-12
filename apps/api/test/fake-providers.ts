import { PROVIDERS, type ScoringProvider } from '@scorecard/domain';
import type { Fetch } from '../src/decisions/adapters/adapter-support.js';

// A stand-in for every decision provider at once, for the FETCH token. It reads the
// questions out of a Gemini, OpenAI or JEV request and answers each one in that
// provider's wire format, so the real adapters, scoring engine and persistence all run
// end to end without a byte leaving the machine.

export interface RecordedProviderRequest {
  readonly provider: ScoringProvider;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: any;
}

interface Failure {
  readonly status: number;
  readonly body: unknown;
}

const INPUT_TOKENS = 1_000;
const OUTPUT_TOKENS = 10;

// One probability per level: most of the mass on `level`, the rest on its neighbours.
const distribution = (levels: number, level: number): number[] => {
  const probabilities = new Array<number>(levels).fill(0);
  const neighbours = [level - 1, level + 1].filter((index) => index >= 0 && index < levels);
  probabilities[level] = neighbours.length === 0 ? 1 : 0.8;
  for (const index of neighbours) probabilities[index] = 0.2 / neighbours.length;
  return probabilities;
};

export class FakeProviders {
  readonly requests: RecordedProviderRequest[] = [];
  // Probability returned for every yes/no question.
  yes = 0.8;
  // Rubric level returned for a question with `levels` levels: one below the top.
  scoreLevel: (levels: number) => number = (levels) => Math.max(0, levels - 2);
  // Milliseconds each response waits before arriving.
  delayMs = 0;
  private readonly failures = new Map<ScoringProvider, Failure>();

  // Every later request to `provider` fails with this HTTP status and body.
  fail(provider: ScoringProvider, status: number, body: unknown): void {
    this.failures.set(provider, { status, body });
  }

  recover(provider: ScoringProvider): void {
    this.failures.delete(provider);
  }

  requestsFor(provider: ScoringProvider): RecordedProviderRequest[] {
    return this.requests.filter((request) => request.provider === provider);
  }

  readonly fetch: Fetch = (async (input: Parameters<Fetch>[0], init?: RequestInit) => {
    const url = String(input);
    const provider = (Object.keys(PROVIDERS) as ScoringProvider[]).find(
      (id) => PROVIDERS[id].endpoint === url,
    );
    if (!provider) throw new Error(`Fake providers: unexpected URL ${url}`);
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    const body = JSON.parse(rawBody);
    this.requests.push({
      provider,
      url,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      rawBody,
      body,
    });
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));

    const failure = this.failures.get(provider);
    if (failure) return json(failure.body, failure.status);
    if (provider === 'openai') return json(this.openAi(body));
    const answers = this.mapAnswers(body.questions, provider === 'jev');
    return provider === 'gemini'
      ? json({
          answers,
          usage: { total_input_tokens: INPUT_TOKENS, total_output_tokens: OUTPUT_TOKENS },
        })
      : json({
          model: 'jev-fake',
          answers,
          usage: { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS },
        });
  }) as Fetch;

  // Gemini and JEV: questions and answers are maps keyed by name.
  private mapAnswers(questions: Record<string, any>, jev: boolean): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(questions).map(([key, question]) => {
        if (question.type === 'noul') {
          return [
            key,
            jev
              ? { type: 'noul', noul: this.yes }
              : { type: 'noul', noul: this.yes, confidence: Math.max(this.yes, 1 - this.yes) },
          ];
        }
        if (question.type === 'choice') {
          const options = Object.keys(question.criteria);
          return [
            key,
            {
              type: 'choice',
              choice: options[0],
              confidence: 0.9,
              probabilities: Object.fromEntries(
                options.map((option, index) => [
                  option,
                  index === 0 ? 0.9 : 0.1 / (options.length - 1),
                ]),
              ),
            },
          ];
        }
        const levels = question.criteria.length as number;
        const level = this.scoreLevel(levels);
        return [
          key,
          {
            type: 'score',
            score: level,
            legend: question.criteria[level],
            confidence: 0.8,
            probabilities: Object.fromEntries(
              distribution(levels, level).map((probability, index) => [String(index), probability]),
            ),
          },
        ];
      }),
    );
  }

  // OpenAI: an ordered array of named questions, answered in the same order.
  private openAi(body: any): unknown {
    const answers = (body.questions as any[]).map((question) => {
      if (question.type === 'predicate') {
        return { type: 'predicate', name: question.name, probability: this.yes };
      }
      if (question.type === 'choice') {
        const values = (question.choices as Array<{ value: string }>).map((item) => item.value);
        return {
          type: 'choice',
          name: question.name,
          choice: values[0],
          confidence: 0.9,
          probabilities: values.map((value, index) => ({
            value,
            probability: index === 0 ? 0.9 : 0.1 / (values.length - 1),
          })),
        };
      }
      const labels = (question.levels as Array<{ label: string }>).map((item) => item.label);
      const level = this.scoreLevel(labels.length);
      return {
        type: 'score',
        name: question.name,
        score: level,
        confidence: 0.8,
        probabilities: distribution(labels.length, level).map((probability, value) => ({
          value,
          label: labels[value],
          probability,
        })),
      };
    });
    return {
      model: 'gpt-6-luna-fake',
      usage: { input_tokens: INPUT_TOKENS, output_tokens: OUTPUT_TOKENS },
      answers,
    };
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
