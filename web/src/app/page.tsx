import { AttackReplay } from "@/components/sections/attack-replay";
import { Cta } from "@/components/sections/cta";
import { Developers } from "@/components/sections/developers";
import { Faq } from "@/components/sections/faq";
import { Guarantees } from "@/components/sections/guarantees";
import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Problem } from "@/components/sections/problem";
import { Simulator } from "@/components/sections/simulator";
import { StackMarquee } from "@/components/sections/stack-marquee";
import { WhyKovan } from "@/components/sections/why-kovan";

export default function Page() {
  return (
    <main id="main" tabIndex={-1}>
      <Hero />
      <StackMarquee />
      <Problem />
      <HowItWorks />
      <WhyKovan />
      <AttackReplay />
      <Simulator />
      <Guarantees />
      <Developers />
      <Faq />
      <Cta />
    </main>
  );
}
