'use client';

import { ImageIcon, SparklesIcon } from 'lucide-react';
import { FormEvent, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

type GenerateResponse = {
  image?: string;
  error?: string;
};

export function ImageStudio() {
  const [prompt, setPrompt] = useState(
    'A bright, photorealistic Scandinavian living room prepared for a premium real-estate listing',
  );
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, quality: 'low' }),
      });
      const payload = (await response.json()) as GenerateResponse;
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? 'Image generation failed.');
      }
      setImage(payload.image);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Image generation failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Card className="bg-card/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SparklesIcon className="size-4 text-primary" />
            GPT Image 2
          </CardTitle>
          <CardDescription>
            Generate a visual concept for a property experience. Requests pass through SODAR’s server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={generate}>
            <label className="block text-sm font-medium" htmlFor="image-prompt">
              Describe the image
            </label>
            <Textarea
              id="image-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              minLength={3}
              maxLength={2000}
              rows={6}
              className="min-h-36 resize-y bg-background/70"
              disabled={loading}
            />
            <Button type="submit" size="lg" disabled={loading || prompt.trim().length < 3}>
              {loading ? <Spinner /> : <SparklesIcon />}
              {loading ? 'Generating…' : 'Generate image'}
            </Button>
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card className="min-h-[420px] bg-stone-950 shadow-sm">
        <CardContent className="flex h-full min-h-[388px] items-center justify-center p-0">
          {image ? (
            <img
              src={image}
              alt="Generated property concept"
              className="aspect-square h-full max-h-[620px] w-full object-contain"
            />
          ) : (
            <div className="flex max-w-xs flex-col items-center px-8 text-center text-stone-400">
              <ImageIcon className="mb-4 size-8" />
              <p className="text-sm leading-6">
                Your generated property image will appear here.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
