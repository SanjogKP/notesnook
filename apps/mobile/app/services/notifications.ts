/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2022 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import notifee, {
  AndroidStyle,
  AuthorizationStatus,
  DisplayedNotification,
  EventType,
  RepeatFrequency,
  Trigger,
  TriggerType,
  Event,
  TriggerNotification
} from "@notifee/react-native";
import dayjs from "dayjs";
import { Platform } from "react-native";
import { db } from "../common/database";
import { MMKV } from "../common/database/mmkv";
import { editorState } from "../screens/editor/tiptap/utils";
import { useNoteStore } from "../stores/use-notes-store";
import { eOnLoadNote } from "../utils/events";
import { tabBarRef } from "../utils/global-refs";
import { DDS } from "./device-detection";
import { eSendEvent } from "./event-manager";
import SettingsService from "./settings";
import { useSettingStore } from "../stores/use-setting-store";

export type Reminder = {
  id: string;
  type: string;
  title: string;
  description?: string;
  priority: "silent" | "vibrate" | "urgent";
  date?: number;
  mode: "repeat" | "once" | "permanent";
  recurringMode: "week" | "month" | "day";
  selectedDays: number[];
  dateCreated: number;
  dateModified: number;
};

let pinned: DisplayedNotification[] = [];

const onEvent = async ({ type, detail }: Event) => {
  const { notification, pressAction, input } = detail;
  if (type === EventType.PRESS) {
    if (notification?.data?.type !== "pinnedNote") return;
    editorState().movedAway = false;
    MMKV.removeItem("appState");
    if (useNoteStore?.getState()?.loading === false) {
      await db.init();
      await db.notes?.init();
      loadNote(notification?.id as string, false);
      return;
    }
    const unsub = useNoteStore.subscribe(
      (loading) => {
        if (loading === false) {
          loadNote(notification?.id as string, true);
        }
        unsub();
      },
      (state) => state.loading
    );
  }

  if (type === EventType.ACTION_PRESS) {
    switch (pressAction?.id) {
      case "UNPIN":
        remove(notification?.id as string);
        break;
      case "Hide":
        unpinQuickNote();
        break;
      case "ReplyInput":
        displayNotification({
          title: "Quick note",
          message: 'Tap on "Take note" to add a note.',
          ongoing: true,
          actions: ["ReplyInput", "Hide"],
          id: "notesnook_note_input",
          reply_button_text: "Take note",
          reply_placeholder_text: "Write something..."
        });
        await db.init();
        await db.notes?.add({
          content: {
            type: "tiptap",
            data: `<p>${input} </p>`
          }
        });
        await db.notes?.init();
        useNoteStore.getState().setNotes();
        break;
    }
  }
};

async function scheduleNotification(reminder: Reminder, payload?: string) {
  if (useSettingStore.getState().settings.disableReminderNotifications) return;
  try {
    const { title, description, priority } = reminder;
    const triggers = getTriggers(reminder);
    if (!triggers && reminder.mode === "permanent") {
      displayNotification({
        id: reminder.id,
        title: title,
        message: description || "",
        ongoing: true,
        subtitle: description || ""
      });
      return;
    }
    await clearAllPendingTriggersForId(reminder.id);

    if (!triggers) return;
    for (const trigger of triggers) {
      const notif = await notifee.createTriggerNotification(
        {
          id: trigger.id,
          title: title,
          body: description,
          data: {
            type: "reminder",
            payload: payload || "",
            dateModified: reminder.dateModified + ""
          },
          subtitle: description,
          android: {
            channelId: await getChannelId(priority),
            smallIcon: "ic_stat_name",
            pressAction: {
              id: "default",
              mainComponent: "notesnook"
            },
            style: !description
              ? undefined
              : {
                  type: AndroidStyle.BIGTEXT,
                  text: description
                }
          },
          ios: {
            sound: priority === "urgent" ? "default" : undefined,
            interruptionLevel: priority === "silent" ? "passive" : "active"
          }
        },
        trigger
      );
      console.log(notif);
    }
  } catch (e) {
    console.log(e);
  }
}

function loadNote(id: string, jump: boolean) {
  if (!id || id === "notesnook_note_input") return;
  const note = db.notes?.note(id).data;
  if (!DDS.isTab && jump) {
    tabBarRef.current?.goToPage(1);
  }
  eSendEvent("loadingNote", note);
  setTimeout(() => {
    eSendEvent(eOnLoadNote, note);
    if (!jump && !DDS.isTab) {
      tabBarRef.current?.goToPage(1);
    }
  }, 2000);
}
async function getChannelId(id: "silent" | "vibrate" | "urgent" | "default") {
  switch (id) {
    case "default":
      return await notifee.createChannel({
        id: "com.streetwriters.notesnook",
        name: "Default"
      });
    case "silent":
      return await notifee.createChannel({
        id: "com.streetwriters.notesnook.silent",
        name: "Silent",
        vibration: false
      });
    case "vibrate":
      return await notifee.createChannel({
        id: "com.streetwriters.notesnook.silent",
        name: "Silent",
        vibration: true
      });
    case "urgent":
      return await notifee.createChannel({
        id: "com.streetwriters.notesnook.urgent",
        name: "Urgent",
        vibration: true,
        sound: "default"
      });
  }
}

async function displayNotification({
  title,
  message,
  subtitle,
  bigText,
  actions = [],
  ongoing,
  reply_placeholder_text,
  reply_button_text,
  id
}: {
  title?: string;
  message: string;
  subtitle?: string;
  bigText?: string;
  actions?: Array<string>;
  ongoing?: boolean;
  reply_placeholder_text?: string;
  reply_button_text?: string;
  id?: string;
}) {
  if (!(await checkAndRequestPermissions())) return;
  try {
    await notifee.displayNotification({
      id: id,
      title: title,
      body: message,
      subtitle: subtitle,
      data: {
        type: reply_placeholder_text ? "quickNote" : "pinnedNote"
      },
      android: {
        ongoing: ongoing,
        localOnly: true,
        channelId: await getChannelId("default"),
        autoCancel: false,
        actions: actions?.map((action) => ({
          pressAction: {
            id: action
          },
          title:
            action === "ReplyInput" ? (reply_button_text as string) : action,
          input:
            action !== "ReplyInput"
              ? undefined
              : {
                  placeholder: reply_placeholder_text,
                  allowFreeFormInput: true
                }
        })),
        style: !bigText
          ? undefined
          : {
              type: AndroidStyle.BIGTEXT,
              text: bigText
            }
      }
    });
  } catch (e) {
    console.log(e);
  }
}

async function checkAndRequestPermissions() {
  let permissionStatus = await notifee.getNotificationSettings();
  if (Platform.OS === "android") {
    if (
      permissionStatus.authorizationStatus === AuthorizationStatus.AUTHORIZED &&
      permissionStatus.android.alarm === 1
    )
      return true;
    if (permissionStatus.authorizationStatus === AuthorizationStatus.DENIED) {
      permissionStatus = await notifee.requestPermission();
    }
    if (permissionStatus.android.alarm !== 1) {
      await notifee.openAlarmPermissionSettings();
    }
    permissionStatus = await notifee.getNotificationSettings();
    if (
      permissionStatus.authorizationStatus === AuthorizationStatus.AUTHORIZED &&
      permissionStatus.android.alarm === 1
    )
      return true;
    return false;
  } else {
    permissionStatus = await notifee.requestPermission();
    if (permissionStatus.authorizationStatus === AuthorizationStatus.AUTHORIZED)
      return true;
    return false;
  }
}

function getTriggers(
  reminder: Reminder
): (Trigger & { id: string })[] | undefined {
  const { date, recurringMode, selectedDays, mode } = reminder;
  switch (mode) {
    case "once":
      return [
        {
          timestamp: date as number,
          type: TriggerType.TIMESTAMP,
          id: reminder.id,
          alarmManager: {
            allowWhileIdle: true
          }
        }
      ];
    case "permanent":
      return undefined;
    case "repeat" : {
      switch (recurringMode) {
        case "day":
          return [
            {
              timestamp: date as number,
              type: TriggerType.TIMESTAMP,
              repeatFrequency: RepeatFrequency.DAILY,
              id: reminder.id,
              alarmManager: {
                allowWhileIdle: true
              }
            }
          ];
        case "week":
          return selectedDays.length === 7
            ? [
                {
                  timestamp: date as number,
                  type: TriggerType.TIMESTAMP,
                  repeatFrequency: RepeatFrequency.DAILY,
                  id: reminder.id,
                  alarmManager: {
                    allowWhileIdle: true
                  }
                }
              ]
            : selectedDays.map((day) => ({
                timestamp: dayjs(date).day(day).toDate().getTime() as number,
                type: TriggerType.TIMESTAMP,
                repeatFrequency: RepeatFrequency.WEEKLY,
                id: `${reminder.id}_${day}`,
                alarmManager: {
                  allowWhileIdle: true
                }
              }));
        case "month":
          return selectedDays.length === 31
            ? [
                {
                  timestamp: date as number,
                  type: TriggerType.TIMESTAMP,
                  repeatFrequency: RepeatFrequency.DAILY,
                  id: reminder.id,
                  alarmManager: {
                    allowWhileIdle: true
                  }
                }
              ]
            : selectedDays.map((day) => ({
                timestamp: dayjs(date).date(day).toDate().getTime() as number,
                type: TriggerType.TIMESTAMP,
                repeatFrequency: RepeatFrequency.WEEKLY,
                id: `${reminder.id}_${day}`,
                alarmManager: {
                  allowWhileIdle: true
                }
              }));
      }
    }
  }
}

async function unpinQuickNote() {
  remove("notesnook_note_input");
  SettingsService.set({ notifNotes: false });
}

async function removeScheduledNotification(reminder: Reminder, day: number) {
  return notifee.cancelTriggerNotification(
    day ? `${reminder.id}_${day}` : reminder.id
  );
}

async function getScheduledNotificationIds() {
  return notifee.getTriggerNotificationIds();
}

async function clearAllPendingTriggersForId(_id: string) {
  if (!_id) return;
  const ids = await getScheduledNotificationIds();
  for (const id of ids) {
    if (id.startsWith(_id)) {
      await notifee.cancelTriggerNotification(id);
    }
  }
}

function clearAll() {
  notifee.cancelDisplayedNotifications();
}

function clearAllTriggers() {
  notifee.cancelTriggerNotifications();
}

function getPinnedNotes(): DisplayedNotification[] {
  return pinned;
}

function get(): Promise<DisplayedNotification[]> {
  return new Promise((resolve) => {
    if (Platform.OS === "ios") resolve([]);
    notifee.getDisplayedNotifications().then((notifications) => {
      pinned = notifications;
      resolve(notifications);
    });
  });
}

function init() {
  if (Platform.OS === "ios") return;
  notifee.onBackgroundEvent(onEvent);
  notifee.onForegroundEvent(onEvent);
}

async function remove(id: string) {
  await notifee.cancelNotification(id);
  get().then(() => {
    eSendEvent("onUpdate", "unpin");
  });
}

async function pinQuickNote(launch: boolean) {
  if (!(await checkAndRequestPermissions())) return;
  get().then((items) => {
    const notification = items.filter((n) => n.id === "notesnook_note_input");
    if (notification && launch) {
      return;
    }
    displayNotification({
      title: "Quick note",
      message: 'Tap on "Take note" to add a note.',
      ongoing: true,
      actions: ["ReplyInput", "Hide"],
      reply_button_text: "Take note",
      reply_placeholder_text: "Write something...",
      id: "notesnook_note_input"
    });
  });
}

/**
 * A function that checks if reminders need to be reconfigured &
 * reschedules them if anything has changed.
 */
async function setupReminders() {
  const reminders = (db.reminders?.all as Reminder[]) || [];
  const triggers = await notifee.getTriggerNotifications();

  for (const reminder of reminders) {
    const pending = triggers.filter((t) =>
      t.notification.id?.startsWith(reminder.id)
    );
    let needsReschedule = pending.length === 0 ? true : false;
    if (!needsReschedule) {
      needsReschedule = pending[0].notification.data?.dateModified
        ? parseInt(pending[0].notification.data?.dateModified as string) <
          reminder.dateModified
        : true;
    }
    if (needsReschedule) await scheduleNotification(reminder);
  }
  // Check for any triggers whose notifications
  // have been removed.
  const staleTriggers: TriggerNotification[] = [];
  for (const trigger of triggers) {
    if (
      reminders.findIndex((r) => trigger.notification.id?.startsWith(r.id)) ===
      -1
    ) {
      staleTriggers.push(trigger);
    }
  }
  // Remove any stale triggers that are pending
  staleTriggers.forEach(
    (trigger) =>
      trigger.notification.id &&
      notifee.cancelTriggerNotification(trigger.notification.id as string)
  );
}

const Notifications = {
  init,
  displayNotification,
  clearAll,
  remove,
  get,
  getPinnedNotes,
  pinQuickNote,
  unpinQuickNote,
  scheduleNotification,
  removeScheduledNotification,
  getScheduledNotificationIds,
  checkAndRequestPermissions,
  clearAllTriggers,
  setupReminders
};

export default Notifications;
