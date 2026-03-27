package sight.printbridge

object PrintBridgeConfig {
  val fixedDeviceKey: String
    get() = BuildConfig.FIXED_DEVICE_KEY.trim()

  fun hasValidFixedDeviceKey(): Boolean {
    return fixedDeviceKey.length >= 16
  }
}
