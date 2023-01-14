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
import React, { useEffect, useState } from "react";
import { FlatList, Platform, View } from "react-native";
import NotificationSounds, {
  playSampleSound,
  Sound,
  stopSampleSound
} from "react-native-notification-sounds";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { IconButton } from "../../components/ui/icon-button";
import { PressableButton } from "../../components/ui/pressable";
import Paragraph from "../../components/ui/typography/paragraph";
import Notifications from "../../services/notifications";
import SettingsService from "../../services/settings";
import { useSettingStore } from "../../stores/use-setting-store";
import { useThemeStore } from "../../stores/use-theme-store";
import { SIZE } from "../../utils/size";
import notifee from "@notifee/react-native";

const SoundItem = ({
  playingSoundId,
  selectedSoundId,
  item,
  index,
  setPlaying
}: {
  playingSoundId?: string;
  selectedSoundId?: string;
  item: Sound;
  index: number;
  setPlaying: (sound: Sound | undefined) => void;
}) => {
  const colors = useThemeStore((state) => state.colors);
  const isPlaying = playingSoundId === item.soundID;
  return (
    <PressableButton
      customStyle={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        height: 60,
        borderBottomWidth: 1,
        borderRadius: 0,
        borderBottomColor: colors.border,
        paddingHorizontal: 12
      }}
      onPress={async () => {
        SettingsService.set({
          notificationSound:
            item.soundID === "defaultSound"
              ? undefined
              : {
                  ...item,
                  platform: Platform.OS
                }
        });
        Notifications.setupReminders();
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start"
        }}
      >
        <Icon
          size={22}
          name={
            selectedSoundId === item.soundID ||
            (!selectedSoundId && item.soundID === "defaultSound")
              ? "radiobox-marked"
              : "radiobox-blank"
          }
        />
        <Paragraph style={{ marginLeft: 10 }} size={SIZE.md}>
          {item?.title}
        </Paragraph>
      </View>

      {item.soundID === "defaultSound" ? null : (
        <IconButton
          type={isPlaying ? "grayAccent" : "gray"}
          size={22}
          name={isPlaying ? "pause" : "play"}
          color={isPlaying ? colors.accent : colors.gray}
          onPress={() => {
            if (isPlaying) {
              stopSampleSound();
            } else {
              playSampleSound(item);
              setPlaying(item);
              setTimeout(() => {
                setPlaying(undefined);
                stopSampleSound();
              }, 5 * 1000);
            }
          }}
        />
      )}
    </PressableButton>
  );
};

export default function SoundPicker() {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [ringtones, setRingtones] = useState<Sound[]>([]);
  const [playing, setPlaying] = useState<Sound | undefined>();
  const notificationSound = useSettingStore(
    (state) => state.settings.notificationSound
  );

  useEffect(() => {
    NotificationSounds.getNotifications("ringtone").then((results) =>
      setRingtones([
        {
          soundID: "defaultSound",
          title: "Default sound",
          url: ""
        },
        ...results
      ])
    );
    NotificationSounds.getNotifications("notification").then((results) =>
      setSounds([...results])
    );
  }, []);

  return (
    <View>
      <FlatList
        data={[...sounds, ...ringtones]}
        renderItem={({ item, index }) => (
          <SoundItem
            playingSoundId={playing?.soundID}
            selectedSoundId={notificationSound?.soundID}
            item={item}
            index={index}
            setPlaying={setPlaying}
          />
        )}
      />
    </View>
  );
}
