module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo automatically includes the react-native-worklets /
    // reanimated babel plugin (must be last) when reanimated is installed.
    presets: ["babel-preset-expo"],
  };
};
