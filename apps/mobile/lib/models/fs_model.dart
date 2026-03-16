class FsEntry {
  final String name;
  final bool isDirectory;

  const FsEntry({
    required this.name,
    required this.isDirectory,
  });

  factory FsEntry.fromJson(Map<String, dynamic> json) {
    return FsEntry(
      name: json['name'] as String,
      isDirectory: json['isDirectory'] as bool? ?? false,
    );
  }
}

class FsListResult {
  final String sessionId;
  final String path;
  final List<FsEntry> entries;
  final String? error;

  const FsListResult({
    required this.sessionId,
    required this.path,
    required this.entries,
    this.error,
  });

  factory FsListResult.fromJson(Map<String, dynamic> json) {
    return FsListResult(
      sessionId: json['sessionId'] as String,
      path: json['path'] as String,
      entries: (json['entries'] as List<dynamic>?)
              ?.map((e) => FsEntry.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      error: json['error'] as String?,
    );
  }
}
