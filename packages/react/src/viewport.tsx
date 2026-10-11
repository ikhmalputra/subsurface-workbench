"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { Maximize, Minus, Plus } from "lucide-react";
import { CommandButton } from "./ui.js";

export function InteractiveViewport({ name, children }: { name: string; children: ReactNode }) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState("0,0");
  return <div className="sw-viewport" data-testid={`${name}-viewport`} data-scale={scale} data-position={position}>
    <TransformWrapper minScale={0.5} maxScale={8} initialScale={1} limitToBounds={false} doubleClick={{ disabled: true }} onTransform={(_instance, state) => { setScale(state.scale); setPosition(`${state.positionX.toFixed(2)},${state.positionY.toFixed(2)}`); }}>
      {({ zoomIn, zoomOut, resetTransform }) => <>
        <div className="sw-viewport-tools" role="toolbar" aria-label={`${name} navigation`}>
          <CommandButton className="sw-icon-button" title={`Zoom in ${name}`} aria-label={`Zoom in ${name}`} onClick={() => zoomIn(0.3, 0)}><Plus size={16} /></CommandButton>
          <CommandButton className="sw-icon-button" title={`Zoom out ${name}`} aria-label={`Zoom out ${name}`} onClick={() => zoomOut(0.3, 0)}><Minus size={16} /></CommandButton>
          <CommandButton className="sw-icon-button" title={`Fit ${name}`} aria-label={`Fit ${name}`} onClick={() => resetTransform(0)}><Maximize size={15} /></CommandButton>
        </div>
        <TransformComponent wrapperClass="sw-transform-wrapper" contentClass="sw-transform-content">{children}</TransformComponent>
      </>}
    </TransformWrapper>
  </div>;
}