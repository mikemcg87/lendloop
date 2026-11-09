import { HeroCta } from "@/components/HeroCta";
import { PublicToolList } from "@/components/PublicToolList";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        <section className="py-16">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Borrow what you need. Lend what you don&rsquo;t.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-stone-600">
            LendLoop is your street&rsquo;s shared toolbox. Request a drill, a
            ladder or a tent for the dates you need it, pick it up round the
            corner, and hand it back when you are done.
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
