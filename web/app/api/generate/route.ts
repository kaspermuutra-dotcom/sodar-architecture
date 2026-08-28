const OPENAI_IMAGE_ENDPOINT = 'https://api.openai.com/v1/images/generations';

type GenerateBody = {
  prompt?: unknown;
  quality?: unknown;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'Image generation is not configured. Add OPENAI_API_KEY to web/.env.local.' },
      { status: 503 },
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const quality = body.quality === 'medium' ? 'medium' : 'low';
  if (prompt.length < 3 || prompt.length > 2000) {
    return Response.json(
      { error: 'Prompt must be between 3 and 2,000 characters.' },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(OPENAI_IMAGE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        quality,
        size: '1024x1024',
      }),
    });

    const payload = (await upstream.json()) as {
      data?: Array<{ b64_json?: string }>;
      error?: { message?: string };
    };
    if (!upstream.ok) {
      return Response.json(
        { error: payload.error?.message ?? 'OpenAI image generation failed.' },
        { status: upstream.status },
      );
    }

    const imageBase64 = payload.data?.[0]?.b64_json;
    if (!imageBase64) {
      return Response.json({ error: 'OpenAI returned no image data.' }, { status: 502 });
    }

    return Response.json({
      image: `data:image/png;base64,${imageBase64}`,
      model: 'gpt-image-2',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return Response.json({ error: `Image service unavailable: ${message}` }, { status: 502 });
  }
}
