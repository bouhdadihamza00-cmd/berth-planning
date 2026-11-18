const KEY = "jph-interface-preferences";
export const DEFAULT_PREFERENCES = Object.freeze({
  theme: "light",
  fontSize: 13,
  density: "compact",
  motion: "system",
  contrast: "normal",
  language: "en",
});
export function normalizePreferences(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const result = { ...DEFAULT_PREFERENCES };
  for (const [key, choices] of Object.entries({
    theme: ["light", "dark", "system"],
    density: ["compact", "comfortable"],
    motion: ["system", "reduced", "full"],
    contrast: ["normal", "high"],
    language: ["en", "fr", "ar"],
  }))
    if (choices.includes(value[key])) result[key] = value[key];
  const size = Number(value.fontSize);
  if (Number.isFinite(size))
    result.fontSize = Math.min(18, Math.max(11, Math.round(size)));
  return result;
}
const storageKey = () =>
  `${KEY}:${globalThis.window?.P?.S?.user?.id || "browser"}`;
export function getPreferences() {
  try {
    return normalizePreferences(
      JSON.parse(globalThis.localStorage?.getItem(storageKey()) || "{}"),
    );
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function getLocale() {
  return { en: "en-GB", fr: "fr-MA", ar: "ar-MA" }[getPreferences().language];
}
export const getRegionalLocale = getLocale;
const entries = [
  ["Data notes", "Notes sur les données", "ملاحظات البيانات"],
  ["Choose your filters, then generate a preview.", "Choisissez les filtres, puis générez un aperçu.", "اختر عوامل التصفية ثم أنشئ معاينة."],
  ["Skip to workspace", "Aller à l’espace de travail", "الانتقال إلى مساحة العمل"],
  ["Records", "Enregistrements", "السجلات"],
  ["Nominated (t)", "Quantité prévue (t)", "الكمية المخططة (طن)"],
  ["Handled (t)", "Quantité traitée (t)", "الكمية المناولة (طن)"],
  ["Remaining (t)", "Quantité restante (t)", "الكمية المتبقية (طن)"],
  ["Data source", "Source des données", "مصدر البيانات"],
  ["Period & presentation", "Période et présentation", "الفترة والعرض"],
  ["Filters", "Filtres", "التصفية"],
  ["Apply date interval to", "Appliquer la période à", "تطبيق الفترة على"],
  ["Through", "Jusqu’au", "حتى"],
  ["Customer / destination", "Client / destination", "العميل / الوجهة"],
  ["Supplier / origin", "Fournisseur / origine", "المورد / المنشأ"],
  ["Products", "Produits", "المنتجات"],
  ["Grades", "Qualités", "الدرجات"],
  ["Sub-grades", "Sous-qualités", "الدرجات الفرعية"],
  ["Statuses", "Statuts", "الحالات"],
  ["Port overview", "Vue d’ensemble du port", "نظرة عامة على الميناء"],
  ["Current vessel calls, berth occupancy and operational exceptions.", "Escales actuelles, occupation des postes et exceptions opérationnelles.", "زيارات السفن الحالية وإشغال الأرصفة والاستثناءات التشغيلية."],
  ["Active vessel calls", "Escales actives", "زيارات السفن النشطة"],
  ["Upcoming arrivals", "Arrivées prévues", "الوصولات القادمة"],
  ["Berth utilization", "Utilisation des postes", "استغلال الأرصفة"],
  ["Avg. waiting time", "Attente moyenne", "متوسط وقت الانتظار"],
  ["Avg. turnaround", "Durée moyenne d’escale", "متوسط مدة الزيارة"],
  ["Schedule adherence", "Respect du planning", "الالتزام بالجدول"],
  ["Operational delays", "Retards opérationnels", "التأخيرات التشغيلية"],
  ["Planning conflicts", "Conflits de planning", "تعارضات التخطيط"],
  ["Ongoing operations", "Opérations en cours", "العمليات الجارية"],
  ["Berth status", "État des postes", "حالة الأرصفة"],
  ["Cargo throughput", "Volume de marchandises", "حجم مناولة البضائع"],
  ["Alerts & planning risks", "Alertes et risques de planning", "التنبيهات ومخاطر التخطيط"],
  ["View all", "Tout voir", "عرض الكل"],
  ["Open planning", "Ouvrir le planning", "فتح التخطيط"],
  ["Last 30 days", "30 derniers jours", "آخر 30 يومًا"],
  ["Vessel / product", "Navire / produit", "السفينة / المنتج"],
  ["Est. finish", "Fin estimée", "النهاية المتوقعة"],
  ["Entry removed", "Élément supprimé", "تم حذف العنصر"],
  ["Constraint saved", "Contrainte enregistrée", "تم حفظ القيد"],
  ["Constraint removed", "Contrainte supprimée", "تم حذف القيد"],
  ["Approval workflow saved", "Workflow enregistré", "تم حفظ مسار الموافقة"],
  ["Workflow removed", "Workflow supprimé", "تم حذف مسار الموافقة"],
  ["Workflow activated for new proposals", "Workflow activé pour les nouvelles propositions", "تم تفعيل المسار للمقترحات الجديدة"],
  ["Workflow center", "Centre des workflows", "مركز سير العمل"],
  ["Operational assistant", "Assistant opérationnel", "المساعد التشغيلي"],
  ["General app configuration", "Configuration générale", "الإعدادات العامة للتطبيق"],
  ["People", "Personnel", "الأشخاص"],
  ["Ports", "Ports", "الموانئ"],
  ["Products & Cargo", "Produits et cargaisons", "المنتجات والبضائع"],
  ["Rules", "Règles", "القواعد"],
  ["Document Imports", "Import de documents", "استيراد المستندات"],
  ["External Integration", "Intégrations externes", "التكاملات الخارجية"],
  ["Settings", "Paramètres", "الإعدادات"],
  ["Selected port", "Port sélectionné", "الميناء المحدد"],
  ["Administration", "Administration", "الإدارة"],
  ["Live AIS", "AIS en direct", "نظام AIS المباشر"],
  ["Connecting AIS", "Connexion AIS", "جارٍ الاتصال بنظام AIS"],
  ["Make the workspace yours", "Personnalisez votre espace de travail", "خصص مساحة العمل"],
  ["Adjust how the platform looks and feels. Changes apply immediately.", "Personnalisez l’apparence et l’utilisation. Les changements sont immédiats.", "خصص مظهر المنصة واستخدامها. تُطبق التغييرات فورًا."],
  ["Saved on this browser", "Enregistré dans ce navigateur", "محفوظ في هذا المتصفح"],
  ["Appearance", "Apparence", "المظهر"],
  ["Accessibility & language", "Accessibilité et langue", "إمكانية الوصول واللغة"],
  ["Control transitions and interface animations.", "Réglez les transitions et les animations de l’interface.", "تحكم في انتقالات الواجهة وحركاتها."],
  ["Choose the level of visual definition.", "Choisissez le niveau de contraste visuel.", "اختر مستوى التباين البصري."],
  ["Set interface language, dates and numbers.", "Définissez la langue et le format des dates et des nombres.", "حدد لغة الواجهة وتنسيق التواريخ والأرقام."],
  ["Port operations at a glance", "Les opérations portuaires en bref", "نظرة على عمليات الميناء"],
  ["Vessel schedules, berth planning and operational updates.", "Horaires des navires, planification des postes et suivi des opérations.", "جداول السفن وتخطيط الأرصفة وتحديثات العمليات."],
  ["More information in view", "Plus d’informations à l’écran", "معلومات أكثر على الشاشة"],
  ["More room between items", "Plus d’espace entre les éléments", "مساحة أكبر بين العناصر"],
  ["Changes save automatically", "Les changements sont enregistrés automatiquement", "تُحفظ التغييرات تلقائيًا"],
  ["Rules & workflows", "Règles et workflows", "القواعد وسير العمل"],
  ["PORT GOVERNANCE", "GOUVERNANCE PORTUAIRE", "حوكمة الميناء"],
  ["Choose what you want to configure", "Choisissez les paramètres à configurer", "اختر ما تريد إعداده"],
  ["Approval workflows", "Workflows d’approbation", "مسارات الموافقة"],
  ["Physical constraints", "Contraintes physiques", "القيود المادية"],
  ["Equipment constraints", "Contraintes des équipements", "قيود المعدات"],
  ["Cargo access rules", "Règles d’accès des cargaisons", "قواعد وصول البضائع"],
  ["Planning defaults", "Paramètres de planification", "إعدادات التخطيط الافتراضية"],
  ["Mandatory validation", "Contrôles obligatoires", "التحقق الإلزامي"],
  ["Build review stages, assign departments or people, and set approval policies.", "Définissez les étapes de révision, les intervenants et les politiques d’approbation.", "حدد مراحل المراجعة والمراجعين وسياسات الموافقة."],
  ["Vessel length, draft, berth availability and safety gaps.", "Longueur des navires, tirant d’eau, disponibilité et marges de sécurité.", "طول السفن والغاطس وتوافر الأرصفة وفترات الأمان."],
  ["Handling capacity, service availability and served berths.", "Capacité de manutention, disponibilité et postes desservis.", "قدرة المناولة والتوافر والأرصفة المخدومة."],
  ["Control which berths can handle specific products, grades and cargo flows.", "Définissez les postes autorisés pour chaque produit, qualité et flux.", "حدد الأرصفة المسموح بها لكل منتج ودرجة وتدفق بضائع."],
  ["Default durations, safety buffers and scheduling precision.", "Durées par défaut, marges de sécurité et précision du planning.", "المدد الافتراضية وفترات الأمان ودقة الجدولة."],
  ["Review the checks enforced before approval and publication.", "Consultez les contrôles requis avant approbation et publication.", "راجع الفحوص المطلوبة قبل الموافقة والنشر."],
  ["← Rule categories", "← Catégories de règles", "← فئات القواعد"],
  ["← Approval workflows", "← Workflows d’approbation", "← مسارات الموافقة"],
  ["Add workflow", "Ajouter un workflow", "إضافة مسار موافقة"],
  ["Remove workflow", "Supprimer le workflow", "حذف مسار الموافقة"],
  ["Configure workflow", "Configurer le workflow", "إعداد مسار الموافقة"],
  ["New workflow", "Nouveau workflow", "مسار موافقة جديد"],
  ["Workflow name", "Nom du workflow", "اسم مسار الموافقة"],
  ["Number of steps", "Nombre d’étapes", "عدد المراحل"],
  ["Review options", "Options de révision", "خيارات المراجعة"],
  ["Step order", "Ordre des étapes", "ترتيب المراحل"],
  ["Sequential · in numbered order", "Séquentiel · dans l’ordre des étapes", "متسلسل حسب ترتيب المراحل"],
  ["Parallel · at the same time", "Parallèle · simultanément", "متوازٍ في الوقت نفسه"],
  ["Set the number of steps, then choose the approvers for each one.", "Définissez le nombre d’étapes, puis les approbateurs de chacune.", "حدد عدد المراحل ثم اختر الموافقين لكل مرحلة."],
  ["Authors cannot approve their own changes", "Les auteurs ne peuvent pas approuver leurs propres modifications", "لا يمكن للمؤلفين الموافقة على تغييراتهم"],
  ["Step name", "Nom de l’étape", "اسم المرحلة"],
  ["Decision", "Décision", "القرار"],
  ["Approvers", "Approbateurs", "الموافقون"],
  ["Choose people below", "Choisir les personnes ci-dessous", "اختر الأشخاص أدناه"],
  ["Any one reviewer", "Un approbateur suffit", "أي مراجع واحد"],
  ["All assigned reviewers", "Tous les approbateurs désignés", "جميع المراجعين المعينين"],
  ["Move earlier", "Déplacer avant", "تقديم المرحلة"],
  ["Move later", "Déplacer après", "تأخير المرحلة"],
  ["Remove step", "Supprimer l’étape", "حذف المرحلة"],
  ["Add step", "Ajouter une étape", "إضافة مرحلة"],
  ["Save workflow", "Enregistrer le workflow", "حفظ مسار الموافقة"],
  ["Start", "Début", "البداية"],
  ["Finish", "Fin", "النهاية"],
  ["Set active", "Activer", "تفعيل"],
  ["Approval policy", "Politique d’approbation", "سياسة الموافقة"],
  ["Configure", "Configurer", "إعداد"],
  ["View", "Consulter", "عرض"],
  ["Remove", "Supprimer", "حذف"],
  ["Add constraint", "Ajouter une contrainte", "إضافة قيد"],
  ["Edit constraint", "Modifier la contrainte", "تعديل القيد"],
  ["Remove constraint", "Supprimer la contrainte", "حذف القيد"],
  ["Save constraint", "Enregistrer la contrainte", "حفظ القيد"],
  ["Constraint name", "Nom de la contrainte", "اسم القيد"],
  ["Constraint type", "Type de contrainte", "نوع القيد"],
  ["Choose an existing asset", "Choisir un élément existant", "اختر أصلًا موجودًا"],
  ["Limit (units shown in constraint type)", "Limite (unité indiquée dans le type)", "الحد (الوحدة موضحة في نوع القيد)"],
  ["Maximum vessel length (m)", "Longueur maximale du navire (m)", "أقصى طول للسفينة (م)"],
  ["Maximum vessel draft (m)", "Tirant d’eau maximal (m)", "أقصى غاطس للسفينة (م)"],
  ["Minimum safety gap (h)", "Marge de sécurité minimale (h)", "أدنى فترة أمان (ساعة)"],
  ["Maximum handling rate (t/h)", "Débit maximal de manutention (t/h)", "أقصى معدل مناولة (طن/ساعة)"],
  ["Constraint", "Contrainte", "القيد"],
  ["Applies to", "S’applique à", "ينطبق على"],
  ["Limit", "Limite", "الحد"],
  ["Enabled", "Activé", "مفعّل"],
  ["Disabled", "Désactivé", "معطّل"],
  ["Add cargo access rule", "Ajouter une règle d’accès", "إضافة قاعدة وصول للبضائع"],
  ["Rule name", "Nom de la règle", "اسم القاعدة"],
  ["Save rule", "Enregistrer la règle", "حفظ القاعدة"],
  ["Setting", "Paramètre", "الإعداد"],
  ["Current configuration", "Configuration actuelle", "الإعداد الحالي"],
  ["Build your report", "Créer votre rapport", "إنشاء التقرير"],
  ["Report preview", "Aperçu du rapport", "معاينة التقرير"],
  ["Generate preview", "Générer l’aperçu", "إنشاء المعاينة"],
  ["Reset filters", "Réinitialiser les filtres", "إعادة ضبط المرشحات"],
  ["Data version", "Version des données", "نسخة البيانات"],
  ["Group results", "Regrouper les résultats", "تجميع النتائج"],
  ["Search records", "Rechercher des données", "البحث في السجلات"],
  ["Advanced filters", "Filtres avancés", "مرشحات متقدمة"],
  ["Report columns", "Colonnes du rapport", "أعمدة التقرير"],
  ["Select all", "Tout sélectionner", "تحديد الكل"],
  ["Current working version", "Version de travail actuelle", "نسخة العمل الحالية"],
  ["Original workbook snapshot", "Copie originale du classeur", "نسخة المصنف الأصلية"],
  ["Individual records", "Enregistrements individuels", "السجلات الفردية"],
  ["Operational alerts", "Alertes opérationnelles", "التنبيهات التشغيلية"],
  ["Operational exceptions", "Exceptions opérationnelles", "الاستثناءات التشغيلية"],
  ["Workspace notifications", "Notifications de l’espace de travail", "إشعارات مساحة العمل"],
  ["Updates & activity", "Mises à jour et activité", "التحديثات والنشاط"],
  ["Review & publish", "Réviser et publier", "المراجعة والنشر"],
  ["Insights & exports", "Analyses et exports", "التحليلات والتصدير"],
  ["Notifications", "Notifications", "الإشعارات"],
  ["Unread", "Non lu", "غير مقروء"],
  ["Read", "Lu", "مقروء"],
  ["Mark all as read", "Tout marquer comme lu", "تحديد الكل كمقروء"],
  ["All notifications", "Toutes les notifications", "جميع الإشعارات"],
  ["All statuses", "Tous les statuts", "جميع الحالات"],
  ["All cargo", "Toutes les cargaisons", "جميع البضائع"],
  ["Search vessel or cargo…", "Rechercher navire ou cargaison…", "ابحث عن سفينة أو بضاعة…"],
  ["Loading", "Chargement", "تحميل"],
  ["Unloading", "Déchargement", "تفريغ"],
  ["Waiting", "En attente", "في الانتظار"],
  ["Scheduled", "Planifié", "مجدول"],
  ["Delayed", "Retardé", "متأخر"],
  ["Berthed", "À quai", "راسية"],
  ["Completed", "Terminé", "مكتمل"],
  ["Cancelled", "Annulé", "ملغى"],
  ["Available", "Disponible", "متاح"],
  ["Maintenance", "Maintenance", "صيانة"],
  ["Closed", "Fermé", "مغلق"],
  ["Outage", "Indisponible", "متوقف"],
  ["Published schedule", "Planning publié", "الجدول المنشور"],
  ["Plan history", "Historique du planning", "سجل التخطيط"],
  ["Scenario intelligence", "Analyse de scénarios", "تحليل السيناريوهات"],
  ["Berths & terminals", "Postes et terminaux", "الأرصفة والمحطات"],
  ["People & permissions", "Personnel et autorisations", "الأشخاص والصلاحيات"],
  ["Create user", "Créer un utilisateur", "إضافة مستخدم"],
  ["Edit access", "Modifier l’accès", "تعديل الوصول"],
  ["Port role", "Rôle au port", "الدور في الميناء"],
  ["Person", "Personne", "الشخص"],
  ["Capabilities", "Droits", "الصلاحيات"],
  ["Create a port", "Créer un port", "إضافة ميناء"],
  ["New organization", "Nouvelle organisation", "مؤسسة جديدة"],
  ["Berths & equipment", "Postes et équipements", "الأرصفة والمعدات"],
  ["All ports", "Tous les ports", "جميع الموانئ"],
  ["All assets", "Tous les éléments", "جميع الأصول"],
  ["Port map", "Carte du port", "خريطة الميناء"],
  ["Place on map", "Placer sur la carte", "تحديد الموقع على الخريطة"],
  ["Reposition", "Repositionner", "تغيير الموقع"],
  ["Placed", "Positionné", "محدد الموقع"],
  ["Not placed", "Non positionné", "غير محدد الموقع"],
  ["Map position", "Position sur la carte", "الموقع على الخريطة"],
  ["Operational details", "Détails opérationnels", "تفاصيل التشغيل"],
  ["Asset", "Élément", "الأصل"],
  ["Type", "Type", "النوع"],
  ["Add product / specification", "Ajouter un produit / une spécification", "إضافة منتج / مواصفة"],
  ["Add grade / sub-grade", "Ajouter une qualité / sous-qualité", "إضافة درجة / درجة فرعية"],
  ["Delete subgrade", "Supprimer la sous-qualité", "حذف الدرجة الفرعية"],
  ["Delete grade", "Supprimer la qualité", "حذف الدرجة"],
  ["Remove product", "Supprimer le produit", "حذف المنتج"],
  ["Product icon", "Icône du produit", "أيقونة المنتج"],
  ["Import history", "Historique des imports", "سجل الاستيراد"],
  ["Upload documents", "Importer des documents", "رفع المستندات"],
  ["Remove import", "Supprimer l’import", "حذف الاستيراد"],
  ["Find an import", "Rechercher un import", "البحث عن استيراد"],
  ["Source", "Source", "المصدر"],
  ["Validation", "Validation", "التحقق"],
  ["Action", "Action", "الإجراء"],
  ["Add connector", "Ajouter un connecteur", "إضافة موصل"],
  ["Protocol", "Protocole", "البروتوكول"],
  ["Data", "Données", "البيانات"],
  ["State", "État", "الحالة"],
  ["Name", "Nom", "الاسم"],
  ["Temperature", "Température", "درجة الحرارة"],
  ["Wind", "Vent", "الرياح"],
  ["Gusts", "Rafales", "هبّات الرياح"],
  ["Pressure", "Pression", "الضغط"],
  ["Remove entry", "Supprimer l’élément", "حذف العنصر"],
  ["Filter this list…", "Filtrer cette liste…", "تصفية هذه القائمة…"],
  ["All columns", "Toutes les colonnes", "جميع الأعمدة"],
  ["Any value", "Toutes les valeurs", "أي قيمة"],
  ["General settings", "Paramètres généraux", "الإعدادات العامة"],
  [
    "Appearance & usability",
    "Apparence et ergonomie",
    "المظهر وسهولة الاستخدام",
  ],
  ["Theme", "Thème", "المظهر"],
  ["Light", "Clair", "فاتح"],
  ["Dark", "Sombre", "داكن"],
  ["Follow system", "Suivre le système", "حسب النظام"],
  ["Font size", "Taille du texte", "حجم الخط"],
  ["Display density", "Densité d’affichage", "كثافة العرض"],
  ["Compact", "Compacte", "مدمج"],
  ["Comfortable", "Confortable", "مريح"],
  ["Motion", "Animations", "الحركة"],
  ["Reduced motion", "Animations réduites", "تقليل الحركة"],
  ["Full motion", "Animations activées", "حركة كاملة"],
  ["Contrast", "Contraste", "التباين"],
  ["Standard", "Standard", "عادي"],
  ["High contrast", "Contraste élevé", "تباين عالٍ"],
  [
    "Language & regional formats",
    "Langue et formats régionaux",
    "اللغة والتنسيقات المحلية",
  ],
  ["Reset preferences", "Réinitialiser les préférences", "إعادة ضبط التفضيلات"],
  [
    "Preferences saved on this browser.",
    "Préférences enregistrées dans ce navigateur.",
    "تم حفظ التفضيلات في هذا المتصفح.",
  ],
  [
    "Interface labels and regional formats follow this setting. Vessel names, cargo descriptions and imported remarks retain their source language.",
    "Ce réglage concerne les libellés et les formats régionaux. Les noms des navires, descriptions des cargaisons et remarques importées conservent leur langue d’origine.",
    "يطبق هذا الإعداد على عناصر الواجهة والتنسيقات المحلية. تبقى أسماء السفن وأوصاف البضائع والملاحظات المستوردة بلغتها الأصلية.",
  ],
  ["Overview", "Vue d’ensemble", "نظرة عامة"],
  ["Dashboard", "Tableau de bord", "لوحة المتابعة"],
  ["Vessels", "Navires", "السفن"],
  ["Vessel calls", "Escales", "زيارات السفن"],
  ["Berth planning", "Planification des postes", "تخطيط الأرصفة"],
  ["Operations", "Opérations", "العمليات"],
  ["Analytics", "Analyses", "التحليلات"],
  ["Reports", "Rapports", "التقارير"],
  ["Reporting", "Rapports", "التقارير"],
  ["Configuration", "Configuration", "الإعدادات"],
  ["Settings", "Paramètres", "الإعدادات"],
  ["Approvals", "Approbations", "الموافقات"],
  ["Alerts", "Alertes", "التنبيهات"],
  ["Delays", "Retards", "التأخيرات"],
  ["Equipment", "Équipements", "المعدات"],
  ["Berths", "Postes à quai", "الأرصفة"],
  ["Readiness", "Préparation", "الجاهزية"],
  ["Scenarios", "Scénarios", "السيناريوهات"],
  ["Product catalogue", "Catalogue produits", "دليل المنتجات"],
  ["Product specifications", "Spécifications des produits", "مواصفات المنتجات"],
  [
    "Search product catalogue",
    "Rechercher dans le catalogue",
    "البحث في دليل المنتجات",
  ],
  ["Add specification", "Ajouter une spécification", "إضافة مواصفة"],
  ["Save specification", "Enregistrer la spécification", "حفظ المواصفة"],
  [
    "Edit cargo specification",
    "Modifier une spécification",
    "تعديل مواصفة البضاعة",
  ],
  [
    "Add cargo specification",
    "Ajouter une spécification",
    "إضافة مواصفة البضاعة",
  ],
  [
    "Find reference, product, grade or sub-grade…",
    "Rechercher référence, produit, qualité ou sous-qualité…",
    "ابحث بالمرجع أو المنتج أو الدرجة أو الدرجة الفرعية…",
  ],
  ["Filter catalogue by flow", "Filtrer par flux", "تصفية حسب التدفق"],
  ["Filter catalogue by product", "Filtrer par produit", "تصفية حسب المنتج"],
  ["Filter catalogue by grade", "Filtrer par qualité", "تصفية حسب الدرجة"],
  [
    "Filter catalogue by sub-grade",
    "Filtrer par sous-qualité",
    "تصفية حسب الدرجة الفرعية",
  ],
  ["Reference", "Référence", "المرجع"],
  ["Flow", "Flux", "التدفق"],
  ["Product", "Produit", "المنتج"],
  ["Grade", "Qualité", "الدرجة"],
  ["Sub-grade", "Sous-qualité", "الدرجة الفرعية"],
  ["Cargo flow", "Flux de cargaison", "تدفق البضاعة"],
  ["Product name", "Nom du produit", "اسم المنتج"],
  ["Product grade", "Qualité du produit", "درجة المنتج"],
  ["Product sub-grade", "Sous-qualité du produit", "الدرجة الفرعية للمنتج"],
  [
    "Sub-grade, optional",
    "Sous-qualité, facultative",
    "الدرجة الفرعية، اختيارية",
  ],
  ["Reset filters", "Réinitialiser les filtres", "إعادة ضبط المرشحات"],
  ["Filters", "Filtres", "المرشحات"],
  ["Search", "Rechercher", "بحث"],
  ["Apply filters", "Appliquer les filtres", "تطبيق المرشحات"],
  ["All flows", "Tous les flux", "جميع التدفقات"],
  ["All products", "Tous les produits", "جميع المنتجات"],
  ["All grades", "Toutes les qualités", "جميع الدرجات"],
  ["All sub-grades", "Toutes les sous-qualités", "جميع الدرجات الفرعية"],
  ["Save", "Enregistrer", "حفظ"],
  ["Cancel", "Annuler", "إلغاء"],
  ["Close", "Fermer", "إغلاق"],
  ["Edit", "Modifier", "تعديل"],
  ["Delete", "Supprimer", "حذف"],
  ["Add", "Ajouter", "إضافة"],
  ["Create", "Créer", "إنشاء"],
  ["Update", "Mettre à jour", "تحديث"],
  ["Refresh", "Actualiser", "تحديث"],
  ["Reset", "Réinitialiser", "إعادة ضبط"],
  ["Apply", "Appliquer", "تطبيق"],
  ["Confirm", "Confirmer", "تأكيد"],
  ["Continue", "Continuer", "متابعة"],
  ["Back", "Retour", "رجوع"],
  ["Next", "Suivant", "التالي"],
  ["Previous", "Précédent", "السابق"],
  ["Day", "Jour", "يوم"],
  ["Week", "Semaine", "أسبوع"],
  ["Month", "Mois", "شهر"],
  ["Year", "Année", "سنة"],
  ["Today", "Aujourd’hui", "اليوم"],
  ["Report date", "Date du rapport", "تاريخ التقرير"],
  ["Start date", "Date de début", "تاريخ البداية"],
  ["End date", "Date de fin", "تاريخ النهاية"],
  ["From", "Du", "من"],
  ["To", "Au", "إلى"],
  ["Duration", "Durée", "المدة"],
  ["Planned start", "Début prévu", "البداية المخططة"],
  ["Planned completion", "Fin prévue", "الانتهاء المخطط"],
  ["Duration, hours", "Durée, heures", "المدة بالساعات"],
  ["Vessel", "Navire", "السفينة"],
  ["Vessel name", "Nom du navire", "اسم السفينة"],
  ["Berth", "Poste à quai", "الرصيف"],
  ["Quantity", "Quantité", "الكمية"],
  ["Progress", "Avancement", "التقدم"],
  ["Status", "Statut", "الحالة"],
  ["Actions", "Actions", "الإجراءات"],
  ["Department", "Département", "القسم"],
  ["Departments", "Départements", "الأقسام"],
  ["Roles", "Rôles", "الأدوار"],
  ["Users", "Utilisateurs", "المستخدمون"],
  ["Permissions", "Autorisations", "الصلاحيات"],
  ["Planning rules", "Règles de planification", "قواعد التخطيط"],
  ["External integrations", "Intégrations externes", "التكاملات الخارجية"],
  [
    "Geographic configuration",
    "Configuration géographique",
    "الإعدادات الجغرافية",
  ],
  ["Port boundary", "Limite du port", "حدود الميناء"],
  ["Finish drawing", "Terminer le tracé", "إنهاء الرسم"],
  ["Draw berth", "Tracer un poste", "رسم رصيف"],
  ["Add berth", "Ajouter un poste", "إضافة رصيف"],
  ["Add equipment", "Ajouter un équipement", "إضافة معدة"],
  ["Save configuration", "Enregistrer la configuration", "حفظ الإعدادات"],
  ["Port view", "Vue du port", "عرض الميناء"],
  ["Layers", "Couches", "الطبقات"],
  ["Map", "Carte", "الخريطة"],
  ["Find a vessel…", "Rechercher un navire…", "ابحث عن سفينة…"],
  ["Generate report", "Générer le rapport", "إنشاء تقرير"],
  ["Export report", "Exporter le rapport", "تصدير التقرير"],
  ["Custom report", "Rapport personnalisé", "تقرير مخصص"],
  ["Data type", "Type de données", "نوع البيانات"],
  ["Date range", "Période", "الفترة"],
  ["Group by", "Regrouper par", "التجميع حسب"],
  ["Source", "Source", "المصدر"],
  ["Save changes", "Enregistrer les modifications", "حفظ التغييرات"],
  ["Add delay", "Ajouter un retard", "إضافة تأخير"],
  ["New vessel call", "Nouvelle escale", "زيارة سفينة جديدة"],
  ["Edit vessel call", "Modifier l’escale", "تعديل زيارة السفينة"],
  ["Save vessel call", "Enregistrer l’escale", "حفظ زيارة السفينة"],
];
const dictionary = new Map(entries.map(([en, fr, ar]) => [en, { en, fr, ar }]));
export function translateText(value, language = getPreferences().language) {
  const exact = dictionary.get(value)?.[language];
  if (exact) return exact;
  const step = /^Step (\d+)$/.exec(value);
  if (step) return `${{en:"Step",fr:"Étape",ar:"المرحلة"}[language] || "Step"} ${step[1]}`;
  return value;
}
const originalText = new WeakMap(),
  originalAttributes = new WeakMap();
// Only structural interface labels are candidates. Table cells, descriptions,
// select values and arbitrary record content are deliberately excluded.
export function translateUI(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  const language = getPreferences().language;
  const selector =
    "option, .report-summary small, .report-empty small, .report-empty p, .report-empty-steps span, .workflow-step legend, .config-nav button, .workflow-tab-copy strong, .workflow-tab-copy small, .rule-category-card strong, .rule-category-card p, .rule-hub-intro h2, .rule-kicker, .workflow-endpoint, .preference-section h3, .preference-setting-copy strong, .preference-setting-copy p, .preferences-intro h2, .preferences-intro p, .preferences-local-note, .preference-density-choice strong, .preference-density-choice small, .preference-label-line label, .preference-choice-field legend, .report-section h4, .rule-category-intro p, .page-heading p, .card-head h3, .modal-head h2, .config-nav .nav-caption, nav a, nav button, .sidebar a, .sidebar button, .nav-label, .page-heading h1, .card-head h2, .card-header h2, .modal-header h2, .section-title, .metric-label, .field > span, .catalog-filter span, th, button, label, [data-i18n]";
  const elements = [
    ...(root.matches?.(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
  for (const el of elements) {
    if (
      el.closest("td, .vessel-cell, [data-user-content]") &&
      !el.matches("button")
    )
      continue;
    if (el.matches("[data-vessel], [data-call], [data-record], [data-alert]"))
      continue;
    for (const node of el.childNodes) {
      if (node.nodeType !== 3) continue;
      const current = node.textContent,
        previous = originalText.get(node);
      const source =
        previous && current === previous.translated ? previous.source : current;
      const trimmed = source.trim();
      if (!dictionary.has(trimmed) && translateText(trimmed, language) === trimmed && !previous) continue;
      const translated = source.replace(
        trimmed,
        translateText(trimmed, language),
      );
      if (el.tagName === "OPTION" && !el.hasAttribute("value")) el.setAttribute("value", el.value);
      if (node.textContent !== translated) node.textContent = translated;
      originalText.set(node, { source, translated });
    }
  }
  for (const el of root.querySelectorAll(
    "[aria-label], [placeholder], [title]",
  )) {
    let saved = originalAttributes.get(el) || {};
    for (const name of ["aria-label", "placeholder", "title"]) {
      const current = el.getAttribute(name);
      if (current === null) continue;
      const old = saved[name];
      const source = old && current === old.translated ? old.source : current;
      if (!dictionary.has(source)) continue;
      const translated = translateText(source, language);
      if (current !== translated) el.setAttribute(name, translated);
      saved[name] = { source, translated };
    }
    originalAttributes.set(el, saved);
  }
}
let watching = false;
let translationObserver;
function watchTranslations(doc) {
  if (translationObserver || !globalThis.MutationObserver) return;
  const pending = new Set();
  let frame;
  translationObserver = new MutationObserver(records => {
    for (const record of records) {
      const root = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      if (root?.closest?.('#app,#overlay,#toasts,#assistant-chat')) pending.add(root);
    }
    if (!pending.size || frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const roots = [...pending]; pending.clear();
      roots.filter(root => root.isConnected).forEach(root => translateUI(root));
    });
  });
  translationObserver.observe(doc.body, { childList: true, subtree: true, characterData: true });
}
export function applyPreferences() {
  const prefs = getPreferences(),
    doc = globalThis.document;
  if (!doc) return prefs;
  const media = (query) => globalThis.matchMedia?.(query)?.matches || false;
  doc.documentElement.dataset.theme =
    prefs.theme === "system"
      ? media("(prefers-color-scheme: dark)")
        ? "dark"
        : "light"
      : prefs.theme;
  doc.documentElement.dataset.density = prefs.density;
  doc.documentElement.dataset.motion =
    prefs.motion === "reduced" ||
    (prefs.motion === "system" && media("(prefers-reduced-motion: reduce)"))
      ? "reduced"
      : "full";
  doc.documentElement.dataset.contrast = prefs.contrast;
  doc.documentElement.lang = prefs.language;
  doc.documentElement.dir = prefs.language === "ar" ? "rtl" : "ltr";
  doc.documentElement.style.setProperty(
    "--app-font-size",
    `${prefs.fontSize}px`,
  );
  doc.documentElement.style.setProperty(
    "--ui-font-scale",
    String(prefs.fontSize / 13),
  );
  if (!watching && globalThis.matchMedia) {
    watching = true;
    for (const query of [
      "(prefers-color-scheme: dark)",
      "(prefers-reduced-motion: reduce)",
    ])
      globalThis
        .matchMedia(query)
        .addEventListener("change", () => applyPreferences());
  }
  translateUI(doc);
  watchTranslations(doc);
  return prefs;
}
export function renderPreferences() {
  const { cardHead, esc, icon } = window.P,
    prefs = getPreferences(),
    t = (text) => esc(translateText(text, prefs.language));
  const choices = (key, options) =>
    `<select name="${key}" aria-label="${t(key === "motion" ? "Motion" : key === "contrast" ? "Contrast" : "Language & regional formats")}">${options.map(([value, label]) => `<option value="${value}" ${prefs[key] === value ? "selected" : ""}>${t(label)}</option>`).join("")}</select>`;
  const row = (symbol, title, description, control) =>
    `<div class="preference-setting-row"><span class="preference-setting-icon">${icon(symbol)}</span><div class="preference-setting-copy"><strong>${t(title)}</strong><p>${t(description)}</p></div>${control}</div>`;
  return `<section class="card preferences-card">${cardHead(t("Appearance & usability"), "settings")}<form id="preferences-form" class="preferences-form"><div class="preferences-scroll"><div class="preferences-columns"><section class="preference-section"><div class="preference-section-heading">${icon("palette")}<h3>${t("Appearance")}</h3></div><fieldset class="preference-choice-field"><legend>${t("Theme")}</legend><div class="preference-theme-options">${[
    ["light", "Light", "sun"],
    ["dark", "Dark", "moon"],
    ["system", "Follow system", "monitor"],
  ]
    .map(
      ([value, label, symbol]) =>
        `<label class="preference-theme-choice"><input type="radio" name="theme" value="${value}" ${prefs.theme === value ? "checked" : ""}><span class="preference-theme-preview theme-preview-${value}" aria-hidden="true"><i class="preview-nav"></i><span class="preview-main"><i></i><span><i></i><i></i></span><i></i></span></span><span class="preference-choice-caption">${icon(symbol)}${t(label)}<i class="preference-radio-dot"></i></span></label>`,
    )
    .join(
      "",
    )}</div></fieldset><div class="preference-type"><div class="preference-label-line"><label for="preference-font-size">${t("Font size")}</label><output id="font-size-value">${prefs.fontSize}px</output></div><div class="preference-font-slider"><span>A</span><input id="preference-font-size" name="fontSize" type="range" min="11" max="18" step="1" value="${prefs.fontSize}"><span>A</span></div><div class="preference-font-preview" id="preference-font-preview" style="font-size:${prefs.fontSize}px"><strong>${t("Port operations at a glance")}</strong><span>${t("Vessel schedules, berth planning and operational updates.")}</span></div></div><fieldset class="preference-choice-field"><legend>${t("Display density")}</legend><div class="preference-density-options">${[
    ["compact", "Compact", "rows-3", "More information in view"],
    ["comfortable", "Comfortable", "rows-2", "More room between items"],
  ]
    .map(
      ([value, label, symbol, description]) =>
        `<label class="preference-density-choice"><input type="radio" name="density" value="${value}" ${prefs.density === value ? "checked" : ""}>${icon(symbol)}<span><strong>${t(label)}</strong><small>${t(description)}</small></span><i class="preference-radio-dot"></i></label>`,
    )
    .join(
      "",
    )}</div></fieldset></section><section class="preference-section"><div class="preference-section-heading">${icon("sliders-horizontal")}<h3>${t("Accessibility & language")}</h3></div>${row(
    "sparkles",
    "Motion",
    "Control transitions and interface animations.",
    choices("motion", [
      ["system", "Follow system"],
      ["reduced", "Reduced motion"],
      ["full", "Full motion"],
    ]),
  )}${row(
    "contrast",
    "Contrast",
    "Choose the level of visual definition.",
    choices("contrast", [
      ["normal", "Standard"],
      ["high", "High contrast"],
    ]),
  )}${row(
    "languages",
    "Language & regional formats",
    "Set interface language, dates and numbers.",
    choices("language", [
      ["en", "English"],
      ["fr", "Français"],
      ["ar", "العربية"],
    ]),
  )}</section></div></div><div class="preferences-footer"><button type="button" class="btn" id="preferences-reset">${icon("rotate-ccw")}${t("Reset preferences")}</button><span role="status" id="preferences-status">${icon("circle-check")}${t("Changes save automatically")}</span></div></form></section>`;
}
export function bindPreferences() {
  const form = document.querySelector("#preferences-form");
  if (!form) return;
  form.onsubmit = (e) => e.preventDefault();
  function save(value, rerender = false) {
    localStorage.setItem(
      storageKey(),
      JSON.stringify(normalizePreferences(value)),
    );
    applyPreferences();
    if (rerender) window.P.renderApp();
    const status = document.querySelector("#preferences-status");
    if (status)
      status.textContent = translateText("Preferences saved on this browser.");
  }
  form.oninput = (e) => {
    const prefs = Object.fromEntries(new FormData(form));
    save(prefs, e.target.name === "language");
    const output = document.querySelector("#font-size-value");
    if (output) output.textContent = `${getPreferences().fontSize}px`;
    const preview = document.querySelector("#preference-font-preview");
    if (preview) preview.style.fontSize = `${getPreferences().fontSize}px`;
  };
  document.querySelector("#preferences-reset").onclick = () =>
    save(DEFAULT_PREFERENCES, true);
}
