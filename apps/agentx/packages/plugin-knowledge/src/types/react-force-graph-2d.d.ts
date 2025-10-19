declare module 'react-force-graph-2d' {
  import { FC } from 'react';

  export interface NodeObject {
    id?: string | number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
    [key: string]: any;
  }

  export interface LinkObject {
    source: string | number | NodeObject;
    target: string | number | NodeObject;
    [key: string]: any;
  }

  export interface ForceGraphMethods {
    d3Force(forceName: string): any;
    d3ReheatSimulation(): void;
    emitParticle(link: LinkObject): void;
    pauseAnimation(): void;
    resumeAnimation(): void;
    centerAt(x?: number, y?: number, ms?: number): void;
    zoom(zoomLevel?: number, ms?: number): void;
    zoomToFit(ms?: number, px?: number): void;
    getGraphBbox(): { x: [number, number]; y: [number, number] };
    screen2GraphCoords(x: number, y: number): { x: number; y: number };
    graph2ScreenCoords(x: number, y: number): { x: number; y: number };
    refresh(): void;
  }

  export interface ForceGraph2DProps<NodeType = NodeObject, LinkType = LinkObject> {
    graphData: {
      nodes: NodeType[];
      links: LinkType[];
    };
    ref?: React.Ref<ForceGraphMethods>;
    nodeRelSize?: number;
    nodeId?: string | ((node: NodeType) => string | number);
    nodeLabel?: string | ((node: NodeType) => string | null);
    nodeVal?: number | string | ((node: NodeType) => number);
    nodeVisibility?: boolean | string | ((node: NodeType) => boolean);
    nodeColor?: string | ((node: NodeType) => string);
    nodeAutoColorBy?: string | ((node: NodeType) => string | null);
    nodeCanvasObject?: (node: NodeType, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    nodeCanvasObjectMode?: string | ((node: NodeType) => string);
    onNodeClick?: (node: NodeType, event: MouseEvent) => void;
    onNodeRightClick?: (node: NodeType, event: MouseEvent) => void;
    onNodeHover?: (node: NodeType | null, previousNode: NodeType | null) => void;
    onNodeDrag?: (node: NodeType, translate: { x: number; y: number }) => void;
    onNodeDragEnd?: (node: NodeType, translate: { x: number; y: number }) => void;
    linkSource?: string | ((link: LinkType) => string | number | NodeType);
    linkTarget?: string | ((link: LinkType) => string | number | NodeType);
    linkLabel?: string | ((link: LinkType) => string | null);
    linkVisibility?: boolean | string | ((link: LinkType) => boolean);
    linkColor?: string | ((link: LinkType) => string);
    linkAutoColorBy?: string | ((link: LinkType) => string | null);
    linkWidth?: number | string | ((link: LinkType) => number);
    linkCurvature?: number | string | ((link: LinkType) => number);
    linkCanvasObject?: (link: LinkType, ctx: CanvasRenderingContext2D, globalScale: number) => void;
    linkCanvasObjectMode?: string | ((link: LinkType) => string);
    linkDirectionalArrowLength?: number | string | ((link: LinkType) => number);
    linkDirectionalArrowColor?: string | ((link: LinkType) => string);
    linkDirectionalArrowRelPos?: number | string | ((link: LinkType) => number);
    linkDirectionalParticles?: number | string | ((link: LinkType) => number);
    linkDirectionalParticleSpeed?: number | string | ((link: LinkType) => number);
    linkDirectionalParticleWidth?: number | string | ((link: LinkType) => number);
    linkDirectionalParticleColor?: string | ((link: LinkType) => string);
    onLinkClick?: (link: LinkType, event: MouseEvent) => void;
    onLinkRightClick?: (link: LinkType, event: MouseEvent) => void;
    onLinkHover?: (link: LinkType | null, previousLink: LinkType | null) => void;
    onBackgroundClick?: (event: MouseEvent) => void;
    onBackgroundRightClick?: (event: MouseEvent) => void;
    onZoom?: (transform: { k: number; x: number; y: number }) => void;
    onZoomEnd?: (transform: { k: number; x: number; y: number }) => void;
    enableNodeDrag?: boolean;
    enableZoomInteraction?: boolean;
    enablePanInteraction?: boolean;
    enablePointerInteraction?: boolean;
    width?: number;
    height?: number;
    backgroundColor?: string;
    [key: string]: any;
  }

  const ForceGraph2D: FC<ForceGraph2DProps>;
  export default ForceGraph2D;
}
