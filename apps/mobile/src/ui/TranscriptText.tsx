import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";

/** Max transcript lines before it collapses behind an expand arrow. */
const MAX_LINES = 3;

/** Fixed gutters so the hidden measuring pass gets the same width as the body. */
const ICON_GUTTER = 14;
const TOGGLE_GUTTER = 18;

interface Props {
  text: string;
  /** Bubble text style (colour/size) — the layout is owned by this component. */
  style?: StyleProp<TextStyle>;
  /** Outer spacing/width (margins, maxWidth) — keep these off the text style. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Icon tint, matched to the bubble the transcript sits in. */
  iconColor?: string;
}

/**
 * Voice-note transcript that clamps to {@link MAX_LINES} lines with an ellipsis
 * and an expand chevron. Long radio traffic transcribes into a dozen lines and
 * would otherwise push the rest of the chat off screen.
 *
 * `onTextLayout` on a clamped `Text` only reports the lines that survived
 * truncation, so the real line count comes from one invisible pass at natural
 * height, laid out over exactly the same width as the visible body.
 */
export function TranscriptText({ text, style, containerStyle, iconColor = "#64748b" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const [measured, setMeasured] = useState(false);

  const onMeasure = useCallback((e: { nativeEvent: { lines: unknown[] } }) => {
    setOverflows(e.nativeEvent.lines.length > MAX_LINES);
    setMeasured(true);
  }, []);

  return (
    <View style={[styles.wrap, containerStyle]}>
      {!measured ? (
        <Text style={[style, styles.probe]} onTextLayout={onMeasure}>
          {text}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Feather name="file-text" size={10} color={iconColor} style={styles.icon} />
        <Text style={[style, styles.body]} numberOfLines={expanded ? undefined : MAX_LINES}>
          {text}
        </Text>
        {/* The gutter is always reserved so the measuring pass stays honest. */}
        <View style={styles.toggleSlot}>
          {overflows ? (
            <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={10}>
              <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={iconColor} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  // Laid out at natural height but invisible; unmounted after one measurement.
  probe: { position: "absolute", opacity: 0, top: 0, left: ICON_GUTTER, right: TOGGLE_GUTTER },
  row: { flexDirection: "row", alignItems: "flex-start" },
  icon: { width: 10, marginRight: ICON_GUTTER - 10, marginTop: 3 },
  body: { flex: 1 },
  toggleSlot: { width: TOGGLE_GUTTER, alignItems: "flex-end", justifyContent: "flex-end", alignSelf: "flex-end" },
});
