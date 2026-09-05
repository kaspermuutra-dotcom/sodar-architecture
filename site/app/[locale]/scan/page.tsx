import type { Metadata } from "next";
import { Scanner } from "@/components/scanner/scanner";

export const metadata: Metadata = { title: "Scan a room — SODAR", robots: { index: false, follow: false } };
export default function ScanPage() { return <Scanner />; }
