"use client";

import AccountTreeIcon from "@mui/icons-material/AccountTree";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutline";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import type { SvgIconProps } from "@mui/material";

/** Icons an official manifest may name in `contributes.activity.icon`. */
export function ExtensionIcon({ icon, ...props }: { icon: string } & SvgIconProps) {
  switch (icon) {
    case "git":
      return <AccountTreeIcon {...props} />;
    case "tests":
      return <ScienceOutlinedIcon {...props} />;
    case "cloud":
      return <CloudOutlinedIcon {...props} />;
    case "security":
      return <ShieldOutlinedIcon {...props} />;
    case "observer":
      return <VisibilityOutlinedIcon {...props} />;
    case "runs":
      return <PlayCircleOutlineIcon {...props} />;
    default:
      return <ExtensionOutlinedIcon {...props} />;
  }
}
