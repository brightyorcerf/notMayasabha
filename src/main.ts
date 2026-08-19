/**
 * Entry point. The kill switch is installed before anything else can run.
 */
import { installNetGuard } from './core/netguard';
installNetGuard();

import { start } from './ui/app';
start();
