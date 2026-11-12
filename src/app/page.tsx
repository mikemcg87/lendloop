import { HeroCta } from "@/components/HeroCta";
import { PublicToolList } from "@/components/PublicToolList";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-x-14 gap-y-10 px-5 py-12 md:grid-cols-[1fr_1.1fr] md:py-16">
        <section>
          <h1 className="text-[2.6rem] leading-[1.08] font-medium tracking-tight sm:text-5xl">
            Borrow what you need. <i className="font-normal">Lend what you don&rsquo;t.</i>
          </h1>
          <p className="mt-5 max-w-md text-lg text-ink-soft">
            The street&rsquo;s tool ledger. Put your name down for a drill, a
            ladder or a tent, collect it from a neighbour, and bring it back
            when you&rsquo;re done.
          </p>
          <div className="mt-8 min-h-12">
            <HeroCta />
          </div>
        </section>
        <PublicToolList />
      </main>
    </>
  );
}
