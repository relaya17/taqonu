import { z } from "zod";
import { SOURCE_AUTHORITY_RANKS } from "../constants/authority.js";

export const sourceAuthorityRankSchema = z.enum(SOURCE_AUTHORITY_RANKS);
