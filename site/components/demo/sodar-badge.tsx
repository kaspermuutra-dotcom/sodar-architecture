import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SodarMark } from "@/components/logo";

/**
 * Small Sodar mark that stays visible over the walkthrough. Top corner, away
 * from Matterport's own controls (which sit along the bottom edge), with a
 * translucent backing for contrast over bright exteriors. Respects safe-area
 * insets on notched phones.
 */
export function SodarBadge() {
  const t = useTranslations("PropertyDemo");
  return (
    <Link href="/" aria-label={t("badgeLabel")} className="demo-badge">
      <SodarMark size={16} className="text-[#f4f2ee]" />
      <span className="wordmark text-[.58rem] text-[#f4f2ee]">Sodar</span>
    </Link>
  );
}
