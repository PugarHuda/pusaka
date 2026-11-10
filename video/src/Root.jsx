import React from "react";
import { Composition } from "remotion";
import { Video } from "./Video.jsx";
import timeline from "./timeline.json";

// One composition per video in script.mjs (Full for YouTube, X for the 2:15 cut, Preview for style review).
export const Root = () => Object.entries(timeline).map(([id, tl]) => (
  <Composition key={id} id={id} component={Video} defaultProps={{ tl }} durationInFrames={tl.durationInFrames} fps={tl.fps} width={tl.width} height={tl.height} />
));
