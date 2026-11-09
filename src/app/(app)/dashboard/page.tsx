"use client";

import { useState } from "react";
import { BrowseTools } from "@/components/dashboard/BrowseTools";
import { MyListings } from "@/components/dashboard/MyListings";
import { IncomingRequests, MyRequests } from "@/components/dashboard/Requests";
import { Tabs } from "@/components/Tabs";

const TABS = [
  { id: "browse", label: "Browse tools" },
  { id: "listings", label: "My Listings" },
  { id: "requests", label: "My Requests" },
  { id: "incoming", label: "Incoming Requests" },
] as const;

export default function DashboardPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("browse");
  return (
    <>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-6">
        {tab === "browse" && <BrowseTools />}
        {tab === "listings" && <MyListings />}
        {tab === "requests" && <MyRequests />}
        {tab === "incoming" && <IncomingRequests />}
      </div>
    </>
  );
}
