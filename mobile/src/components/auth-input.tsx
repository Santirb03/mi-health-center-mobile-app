import { forwardRef, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

export const AuthInput = forwardRef<
  TextInput,
  TextInputProps & { error?: string; password?: boolean }
>(function AuthInput({ error, password, style, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <View style={{ position: "relative" }}>
        <TextInput
          {...props}
          ref={ref}
          secureTextEntry={password ? !visible : props.secureTextEntry}
          style={[
            style,
            { marginBottom: 0 },
            password && { paddingRight: 58 },
            error ? { borderColor: "#b42318", borderWidth: 2 } : null,
          ]}
        />
        {password && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${visible ? "Ocultar" : "Mostrar"} ${props.accessibilityLabel?.toLowerCase() ?? "contraseña"}`}
            accessibilityState={{ disabled: props.editable === false }}
            disabled={props.editable === false}
            onPress={() => setVisible((value) => !value)}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 52,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={{
                width: 25,
                height: 17,
                borderWidth: 2,
                borderColor: "#475467",
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: "#475467",
                }}
              />
              {!visible && (
                <View
                  style={{
                    position: "absolute",
                    width: 30,
                    height: 2,
                    backgroundColor: "#475467",
                    transform: [{ rotate: "-40deg" }],
                  }}
                />
              )}
            </View>
          </Pressable>
        )}
      </View>
      {error && (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: "#b42318", marginTop: 6 }}
        >
          {error}
        </Text>
      )}
    </View>
  );
});
