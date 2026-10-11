import { createContext, useContext, type ReactNode } from "react";
import { colorMapCss, sampleColorMap, type SubsurfaceColorMapName } from "./visual.js";

export type SubsurfaceThemeName = "light" | "dark" | "high-contrast";
export type SubsurfaceDensity = "compact" | "comfortable";

interface VisualConfiguration {
  theme: SubsurfaceThemeName;
  density: SubsurfaceDensity;
}

const defaultConfiguration: VisualConfiguration = { theme: "light", density: "comfortable" };
const VisualConfigurationContext = createContext(defaultConfiguration);

export interface SubsurfaceThemeProviderProps extends VisualConfiguration {
  children: ReactNode;
  className?: string;
}

export function SubsurfaceThemeProvider({
  theme,
  density,
  children,
  className,
}: SubsurfaceThemeProviderProps) {
  return (
    <VisualConfigurationContext.Provider value={{ theme, density }}>
      <div className={className} data-sw-theme={theme} data-sw-density={density}>
        {children}
      </div>
    </VisualConfigurationContext.Provider>
  );
}

export function useSubsurfaceVisualConfiguration(): VisualConfiguration {
  return useContext(VisualConfigurationContext);
}

export interface ColorScaleLegendProps {
  label: string;
  minimum: number;
  maximum: number;
  unit: string;
  colorMap?: SubsurfaceColorMapName;
}

export function ColorScaleLegend({
  label,
  minimum,
  maximum,
  unit,
  colorMap = "cividis",
}: ColorScaleLegendProps) {
  const formatter = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 });
  const ramp = minimum === maximum
    ? sampleColorMap(minimum, [minimum, minimum + Math.max(1, Math.abs(minimum) * Number.EPSILON * 2)], colorMap)
    : colorMapCss(colorMap);
  return (
    <div
      className="sw-color-legend"
      role="img"
      aria-label={`${label} colour scale from ${formatter.format(minimum)} to ${formatter.format(maximum)} ${unit}; low values are at the left.`}
    >
      <span>{label}</span>
      <div className="sw-color-legend-ramp" style={{ background: ramp }} />
      <span>{formatter.format(minimum)} {unit}</span>
      <span>{formatter.format(maximum)} {unit}</span>
    </div>
  );
}
