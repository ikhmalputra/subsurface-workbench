import { DemoPage } from "../../components/showcase";
import { FieldWorkspace } from "../../components/field-workspace";
export const metadata = { title: "Equator field · Spatial section" };
export default function CrossSectionPage() {
  return <DemoPage current="/cross-section/"><FieldWorkspace tool="section" /></DemoPage>;
}
