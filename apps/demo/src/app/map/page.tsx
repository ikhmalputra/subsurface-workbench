import { DemoPage } from "../../components/showcase";
import { FieldWorkspace } from "../../components/field-workspace";
export const metadata = { title: "Equator field · Locate wells" };
export default function MapPage() {
  return <DemoPage current="/map/"><FieldWorkspace tool="spatial" /></DemoPage>;
}
