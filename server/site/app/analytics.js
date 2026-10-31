'use client';
// Starts PostHog in the browser when the deployment has a key (analyticsConfig
// in lib/config.js); see lib/analytics.js for what it sends.
import { useEffect } from 'react';
import { startAnalytics, track } from '../lib/analytics.js';

export default function Analytics({ config }) {
  useEffect(() => {
    startAnalytics(config);
  }, [config]);
  return null;
}

/** Sends `event` once, when it renders: for states the server rendered, such as an outage. */
export function TrackOnce({ event }) {
  useEffect(() => {
    track(event);
  }, [event]);
  return null;
}
