import { ImageStudio } from './image-studio';

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center justify-between border-b px-6 sm:px-10">
        <a href="/" className="flex items-center gap-3" aria-label="SODAR home">
          <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            S
          </span>
          <span className="text-lg font-semibold tracking-[-0.03em]">SODAR</span>
        </a>
        <span className="rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground">
          Local prototype
        </span>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12 sm:px-10 sm:py-16">
        <div className="mb-10 max-w-3xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Property visualization
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            Create a property concept with GPT Image 2.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            The first image provider is connected behind a server boundary, ready for SODAR’s capture and reconstruction workflow.
          </p>
        </div>

        <ImageStudio />
      </section>
    </main>
  );
}
