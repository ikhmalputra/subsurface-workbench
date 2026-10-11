import { DemoPage } from "../../components/showcase";
import { FieldWorkspace } from "../../components/field-workspace";
export const metadata = { title: "Equator field · Compare intervals" };
export default function CorrelationPage() {
  return <DemoPage current="/correlation/"><FieldWorkspace tool="correlation" /></DemoPage>;
}
