import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface LiquidMetalButtonProps {
  label?: string;
  onClick?: () => void;
  viewMode?: "text" | "icon";
  icon?: React.ReactNode;
  width?: number;
  height?: number;
  fullWidth?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  testId?: string;
  ariaLabel?: string;
  dataStart?: boolean;
}

function detectSoftwareWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name);
  } catch {
    return false;
  }
}

let cachedSoftwareWebGL: boolean | null = null;
function isSoftwareWebGLRenderer(): boolean {
  if (cachedSoftwareWebGL === null) {
    cachedSoftwareWebGL = detectSoftwareWebGL();
  }
  return cachedSoftwareWebGL;
}

export function LiquidMetalButton({
  label = "Get Started",
  onClick,
  viewMode = "text",
  icon,
  width,
  height,
  fullWidth = false,
  disabled = false,
  type = "button",
  className = "",
  testId,
  ariaLabel,
  dataStart,
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<
    Array<{ x: number; y: number; id: number }>
  >([]);
  const shaderRef = useRef<HTMLDivElement>(null);
  const shaderMount = useRef<ShaderMount | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const rippleId = useRef(0);

  useEffect(() => {
    if (!fullWidth || !containerRef.current) return;
    const el = containerRef.current;
    const updateWidth = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setMeasuredWidth(w);
    };
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateWidth);
      ro.observe(el);
      return () => ro.disconnect();
    }
    return undefined;
  }, [fullWidth]);

  const dimensions = useMemo(() => {
    const targetH = height ?? 46;
    if (viewMode === "icon") {
      const targetW = width ?? targetH;
      return {
        width: targetW,
        height: targetH,
        innerWidth: targetW - 4,
        innerHeight: targetH - 4,
        shaderWidth: targetW,
        shaderHeight: targetH,
      };
    }
    const targetW = fullWidth
      ? Math.max(142, measuredWidth ?? width ?? 260)
      : (width ?? 142);
    return {
      width: targetW,
      height: targetH,
      innerWidth: targetW - 4,
      innerHeight: targetH - 4,
      shaderWidth: targetW,
      shaderHeight: targetH,
    };
  }, [viewMode, width, height, fullWidth, measuredWidth]);

  useEffect(() => {
    const styleId = "shader-canvas-style-exploded";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 100px !important;
        }
        @keyframes ripple-animation {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (isSoftwareWebGLRenderer()) {
      return undefined;
    }

    const loadShader = () => {
      try {
        if (shaderRef.current) {
          shaderMount.current?.dispose?.();
          shaderMount.current = new ShaderMount(
            shaderRef.current,
            liquidMetalFragmentShader,
            {
              u_colorBack: [0.06, 0.07, 0.09, 1],
              u_colorTint: [0.88, 0.9, 0.96, 0.18],
              u_repetition: 3,
              u_softness: 0.45,
              u_shiftRed: 0.22,
              u_shiftBlue: 0.28,
              u_distortion: 0.06,
              u_contour: 0.2,
              u_angle: 45,
              u_scale: 4,
              u_shape: 0,
              u_offsetX: 0.08,
              u_offsetY: -0.06,
              u_isImage: false,
            },
            undefined,
            0.6,
          );
        }
      } catch {
        // Fallback CSS liquid-metal gradient remains active underneath
      }
    };

    loadShader();

    return () => {
      shaderMount.current?.dispose?.();
      shaderMount.current = null;
    };
  }, []);

  const handleMouseEnter = () => {
    if (disabled) return;
    setIsHovered(true);
    shaderMount.current?.setSpeed?.(1);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    shaderMount.current?.setSpeed?.(0.6);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (shaderMount.current?.setSpeed) {
      shaderMount.current.setSpeed(2.4);
      setTimeout(() => {
        if (isHovered) {
          shaderMount.current?.setSpeed?.(1);
        } else {
          shaderMount.current?.setSpeed?.(0.6);
        }
      }, 300);
    }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = { x, y, id: rippleId.current++ };

      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, 600);
    }

    onClick?.();
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${fullWidth ? "w-full block" : "inline-block"} ${disabled ? "opacity-50 pointer-events-none" : ""} ${className}`}
    >
      <div
        style={{
          perspective: "1000px",
          perspectiveOrigin: "50% 50%",
          width: fullWidth ? "100%" : undefined,
        }}
      >
        <div
          style={{
            position: "relative",
            width: fullWidth ? "100%" : `${dimensions.width}px`,
            height: `${dimensions.height}px`,
            transformStyle: "preserve-3d",
            transition:
              "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
            transform: "none",
          }}
        >
          {/* Foreground Text / Icon Layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${dimensions.height}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              padding: "0 16px",
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, gap 0.4s ease",
              transform: "translateZ(20px)",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            {viewMode === "icon" && (
              icon ?? (
                <Sparkles
                  size={16}
                  style={{
                    color: isHovered ? "#ffffff" : "#d4d4d8",
                    filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.7))",
                    transition: "all 0.3s ease",
                  }}
                />
              )
            )}
            {viewMode === "text" && (
              <>
                {icon && (
                  <span
                    className="shrink-0 flex items-center"
                    style={{
                      color: isHovered ? "#ffffff" : "#e4e4e7",
                      filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.7))",
                    }}
                  >
                    {icon}
                  </span>
                )}
                <span
                  style={{
                    fontSize: "13px",
                    color: isHovered ? "#ffffff" : "#e4e4e7",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.8)",
                    transition: "color 0.2s ease",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </div>

          {/* Inner Dark Matte (Dark Dof) Core */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${dimensions.height}px`,
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
              transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.985)" : "translateY(0) scale(1)"}`,
              zIndex: 20,
              padding: "2px",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "100px",
                background: isHovered
                  ? "linear-gradient(180deg, #1f2128 0%, #0d0e12 100%)"
                  : "linear-gradient(180deg, #181a20 0%, #090a0d 100%)",
                boxShadow: isPressed
                  ? "inset 0px 2px 4px rgba(0, 0, 0, 0.6), inset 0px 1px 2px rgba(0, 0, 0, 0.45)"
                  : "inset 0px 1px 0px rgba(255, 255, 255, 0.08)",
                transition:
                  "background 0.2s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>

          {/* Animated Liquid Metal Border Shader Layer */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${dimensions.height}px`,
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
              transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.985)" : "translateY(0) scale(1)"}`,
              zIndex: 10,
            }}
          >
            <div
              style={{
                height: `${dimensions.height}px`,
                width: "100%",
                borderRadius: "100px",
                boxShadow: isPressed
                  ? "0px 0px 0px 1px rgba(255, 255, 255, 0.15), 0px 2px 4px rgba(0, 0, 0, 0.65)"
                  : isHovered
                    ? "0px 0px 0px 1px rgba(255, 255, 255, 0.22), 0px 10px 24px rgba(0, 0, 0, 0.55)"
                    : "0px 0px 0px 1px rgba(255, 255, 255, 0.14), 0px 6px 16px rgba(0, 0, 0, 0.48)",
                transition: "box-shadow 0.2s ease",
                background:
                  "linear-gradient(125deg, #27272a 0%, #71717a 24%, #e4e4e7 48%, #52525b 72%, #18181b 100%)",
                overflow: "hidden",
              }}
            >
              <div
                ref={shaderRef}
                className="shader-container-exploded"
                style={{
                  borderRadius: "100px",
                  overflow: "hidden",
                  position: "relative",
                  width: "100%",
                  height: `${dimensions.shaderHeight}px`,
                }}
              />
            </div>
          </div>

          {/* Interactive Hit Layer */}
          <button
            ref={buttonRef}
            type={type}
            disabled={disabled}
            data-testid={testId}
            data-start={dataStart ? "true" : undefined}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={() => !disabled && setIsPressed(true)}
            onMouseUp={() => setIsPressed(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${dimensions.height}px`,
              background: "transparent",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              outline: "none",
              zIndex: 40,
              transformStyle: "preserve-3d",
              transform: "translateZ(25px)",
              overflow: "hidden",
              borderRadius: "100px",
            }}
            aria-label={ariaLabel || label}
          >
            {ripples.map((ripple) => (
              <span
                key={ripple.id}
                style={{
                  position: "absolute",
                  left: `${ripple.x}px`,
                  top: `${ripple.y}px`,
                  width: "20px",
                  height: "20px",
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0) 70%)",
                  pointerEvents: "none",
                  animation: "ripple-animation 0.6s ease-out",
                }}
              />
            ))}
          </button>
        </div>
      </div>
    </div>
  );
}
