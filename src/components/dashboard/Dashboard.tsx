"use client";

import { useState } from "react";
import { BrowseTools } from "@/components/dashboard/BrowseTools";
import { MyListings } from "@/components/dashboard/MyListings";
import { IncomingRequests, MyRequests } from "@/components/dashboard/Requests";
import { Tabs } from "@/components/Tabs";

const TABS = [
  { id: "browse", label: "The board" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming requests" },
] as const;

export function Dashboard() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("browse");
  return (
    <>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-8">
        {tab === "browse" && <BrowseTools />}
        {tab === "listings" && <MyListings />}
        {tab === "requests" && <MyRequests />}
        {tab === "incoming" && <IncomingRequests />}
      </div>
    </>
  );
}
