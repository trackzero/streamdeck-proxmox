import streamDeck from "@elgato/streamdeck";
import { VmMonitorAction } from "./actions/vm-monitor.js";

streamDeck.actions.registerAction(new VmMonitorAction());
streamDeck.connect();
