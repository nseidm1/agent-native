import { Cockpit } from "@/components/cockpit/Cockpit";

import cockpitCss from "../cockpit-full.css?url";

export const links = () => [{ rel: "stylesheet", href: cockpitCss }];

export function meta() {
  return [{ title: "Family Office · Cockpit" }];
}

/** FA-19087: the whole front-facing cockpit (the top bar, the home column and the card region), served at /cards/cockpit. */
export default function CockpitRoute() {
  return <Cockpit />;
}
