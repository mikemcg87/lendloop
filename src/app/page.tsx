import { PublicToolList } from "@/components/PublicToolList";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">
        <section className="py-16">
          <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Your street already owns every tool you need.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-stone-600">
            LendLoop lets neighbours lend and borrow drills, ladders and
            lawnmowers. Request a tool for the dates you need it, pick it up
            round the corner, hand it back when you are done.
          </p>
        </section>
        <PublicToolList />
      </main>
    </>
  );
}
