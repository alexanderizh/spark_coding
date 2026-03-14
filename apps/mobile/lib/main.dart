import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait for better terminal UX (landscape supported too)
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);

  // Dark system UI overlay for terminal aesthetic
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFF0D0D0D),
      systemNavigationBarIconBrightness: Brightness.light,
    ),
  );

  runApp(
    const ProviderScope(
      child: RemoteClaudeApp(),
    ),
  );
}

class RemoteClaudeApp extends ConsumerWidget {
  const RemoteClaudeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Remote Claude',
      debugShowCheckedModeBanner: false,
      theme: _buildDarkTerminalTheme(),
      routerConfig: router,
    );
  }

  ThemeData _buildDarkTerminalTheme() {
    const backgroundColor = Color(0xFF0D0D0D);
    const surfaceColor = Color(0xFF1A1A1A);
    const primaryColor = Color(0xFF00FF41); // Matrix green
    const onPrimaryColor = Color(0xFF000000);
    const onSurfaceColor = Color(0xFFE0E0E0);
    const errorColor = Color(0xFFFF5252);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: backgroundColor,
      colorScheme: const ColorScheme.dark(
        primary: primaryColor,
        onPrimary: onPrimaryColor,
        secondary: Color(0xFF00CC33),
        onSecondary: onPrimaryColor,
        surface: surfaceColor,
        onSurface: onSurfaceColor,
        error: errorColor,
        onError: Colors.white,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF111111),
        foregroundColor: onSurfaceColor,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: 'monospace',
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: primaryColor,
          letterSpacing: 1.2,
        ),
        iconTheme: IconThemeData(color: onSurfaceColor),
      ),
      textTheme: const TextTheme(
        bodyLarge: TextStyle(
          fontFamily: 'monospace',
          color: onSurfaceColor,
        ),
        bodyMedium: TextStyle(
          fontFamily: 'monospace',
          color: onSurfaceColor,
        ),
        bodySmall: TextStyle(
          fontFamily: 'monospace',
          color: Color(0xFF9E9E9E),
        ),
        titleLarge: TextStyle(
          fontFamily: 'monospace',
          color: primaryColor,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.5,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryColor,
          foregroundColor: onPrimaryColor,
          textStyle: const TextStyle(
            fontFamily: 'monospace',
            fontWeight: FontWeight.bold,
            letterSpacing: 1.0,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primaryColor,
          side: const BorderSide(color: Color(0xFF00FF41), width: 1),
          textStyle: const TextStyle(
            fontFamily: 'monospace',
            letterSpacing: 1.0,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(4),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: Color(0xFF333333)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: Color(0xFF333333)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(4),
          borderSide: const BorderSide(color: primaryColor, width: 1.5),
        ),
        labelStyle: const TextStyle(color: Color(0xFF9E9E9E), fontFamily: 'monospace'),
        hintStyle: const TextStyle(color: Color(0xFF555555), fontFamily: 'monospace'),
        prefixStyle: const TextStyle(color: onSurfaceColor, fontFamily: 'monospace'),
      ),
      cardTheme: CardThemeData(
        color: surfaceColor,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(4),
          side: const BorderSide(color: Color(0xFF2A2A2A)),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: Color(0xFF2A2A2A),
        thickness: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: const Color(0xFF2A2A2A),
        selectedColor: const Color(0xFF003300),
        labelStyle: const TextStyle(
          fontFamily: 'monospace',
          fontSize: 12,
          color: onSurfaceColor,
        ),
        side: const BorderSide(color: Color(0xFF404040)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: Color(0xFF1E1E1E),
        contentTextStyle: TextStyle(
          fontFamily: 'monospace',
          color: onSurfaceColor,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(4)),
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}
