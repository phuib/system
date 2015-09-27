/*
 * Inspector Surface class.
 *
 * The class creates Inspector user interface and all the editors
 * corresponding to the passed configuration in a specified container
 * element.
 *
 */
+function ($) { "use strict";

    // NAMESPACES
    // ============================

    if ($.oc === undefined)
        $.oc = {}

    if ($.oc.inspector === undefined)
        $.oc.inspector = {}

    // CLASS DEFINITION
    // ============================

    var Base = $.oc.foundation.base,
        BaseProto = Base.prototype

    /**
     * Creates the Inspector surface in a container.
     * - containerElement container DOM element
     * - properties array (array of objects)
     * - values - property values, an object
     * - inspectorUniqueId - a string containing the unique inspector identifier. 
     *   The identifier should be a constant for an inspectable element. Use 
     *   $.oc.inspector.helpers.generateElementUniqueId(element) to generate a persistent ID 
     *   for an element. Use $.oc.inspector.helpers.generateUniqueId() to generate an ID
     *   not associated with an element. Inspector uses the ID for storing configuration
     *   related to an element in the document DOM.
     */
    var Surface = function(containerElement, properties, values, inspectorUniqueId, options, parentSurface) {
        if (inspectorUniqueId === undefined) {
            throw new Error('Inspector surface unique ID should be defined.')
        }

        this.options = $.extend({}, Surface.DEFAULTS, typeof options == 'object' && options)
        this.rawProperties = properties
        this.parsedProperties = $.oc.inspector.engine.processPropertyGroups(properties)
        this.container = containerElement
        this.inspectorUniqueId = inspectorUniqueId
        this.values = values
        this.originalValues = $.extend(true, {}, values) // Clone the values hash
        this.idCounter = 1
        this.parentSurface = parentSurface

        this.editors = []
        this.externalParameterEditors = []
        this.tableContainer = null

        Base.call(this)

        this.init()
    }

    Surface.prototype = Object.create(BaseProto)
    Surface.prototype.constructor = Surface

    Surface.prototype.dispose = function() {
        this.unregisterHandlers()
        this.disposeControls()
        this.removeElements()
        this.disposeExternalParameterEditors()
        this.disposeEditors()

        this.container = null
        this.tableContainer = null
        this.rawProperties = null
        this.parsedProperties = null
        this.editors = null
        this.externalParameterEditors = null
        this.values = null
        this.originalValues = null
        this.options.onChange = null
        this.parentSurface = null

        BaseProto.dispose.call(this)
    }

    // INTERNAL METHODS
    // ============================

    Surface.prototype.init = function() {
        this.build()

        $.oc.foundation.controlUtils.markDisposable(this.tableContainer)

        this.registerHandlers()
    }

    Surface.prototype.registerHandlers = function() {
        $(this.tableContainer).one('dispose-control', this.proxy(this.dispose))
        $(this.tableContainer).on('click', 'tr.group, tr.control-group', this.proxy(this.onGroupClick))
    }

    Surface.prototype.unregisterHandlers = function() {
        $(this.tableContainer).off('dispose-control', this.proxy(this.dispose))
        $(this.tableContainer).off('click', 'tr.group, tr.control-group', this.proxy(this.onGroupClick))
    }

    //
    // Building
    //

    /**
     * Builds the Inspector table. The markup generated by this method looks 
     * like this:
     *
     * <div>
     *     <table>
     *         <tbody>
     *             <tr>
     *                 <th data-property="label">
     *                     <div>
     *                         <div>
     *                             <span class="title-element" title="Label">
     *                                 <a href="javascript:;" class="expandControl expanded" data-group-index="1">Expand/Collapse</a>
     *                                 Label
     *                             </span>
     *                         </div>
     *                     </div>
     *                 </th>
     *                 <td>
     *                     Editor markup
     *                 </td>
     *             </tr>
     *         </tbody>
     *     </table>
     * </div>
     */
    Surface.prototype.build = function() {
        this.tableContainer = document.createElement('div')

        var dataTable = document.createElement('table'),
            tbody = document.createElement('tbody')

        $.oc.foundation.element.addClass(dataTable, 'inspector-fields')
        if (this.parsedProperties.hasGroups) {
            $.oc.foundation.element.addClass(dataTable, 'has-groups')
        }

        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var property = this.parsedProperties.properties[i],
                row = this.buildRow(property)

            tbody.appendChild(row)

            // Editor
            //
            this.buildEditor(row, property, dataTable)
        }

        dataTable.appendChild(tbody)
        this.tableContainer.appendChild(dataTable)

        this.container.appendChild(this.tableContainer)

        if (this.options.enableExternalParameterEditor) {
            this.buildExternalParameterEditor(tbody)
        }

        this.focusFirstEditor()
    }

    Surface.prototype.buildRow = function(property) {
        var row = document.createElement('tr'),
            th = document.createElement('th'),
            titleSpan = document.createElement('span'),
            description = this.buildPropertyDescription(property)

        // Table row
        //
        if (property.property) {
            row.setAttribute('data-property', property.property)
        }

        this.applyGroupIndexAttribute(property, row)
        $.oc.foundation.element.addClass(row, this.getRowCssClass(property))

        row.setAttribute('data-inspector-level', this.options.surfaceLevel)
        row.setAttribute('data-inspector-id', this.getInspectorUniqueId())

        // Property head
        //
        this.applyHeadColspan(th, property)

        titleSpan.setAttribute('class', 'title-element')
        titleSpan.setAttribute('title', this.escapeJavascriptString(property.title))
        this.buildGroupExpandControl(titleSpan, property)
        titleSpan.innerHTML += this.escapeJavascriptString(property.title)

        var outerDiv = document.createElement('div'),
            innerDiv = document.createElement('div')

        innerDiv.appendChild(titleSpan)

        if (description) {
            innerDiv.appendChild(description)
        }

        outerDiv.appendChild(innerDiv)
        th.appendChild(outerDiv)
        row.appendChild(th)

        return row
    }

    Surface.prototype.focusFirstEditor = function() {
        if (this.editors.length == 0) {
            return
        }

        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i],
                group = editor.propertyDefinition.group

            if (group && !this.isGroupExpanded(group)) {
                continue
            }

            var externalParameterEditor = this.findExternalParameterEditor(editor.getPropertyName())

            if (externalParameterEditor && externalParameterEditor.isEditorVisible()) {
                externalParameterEditor.focus()
                return
            }

            editor.focus()
            return
        }
    }

    Surface.prototype.getRowCssClass = function(property) {
        var result = property.itemType

        // The property.groupedControl flag doesn't allow to collapse the grouped control row itself.
        if (property.itemType == 'property' && property.groupIndex !== undefined && !property.groupedControl) {
            result += ' grouped'
            result += this.isGroupExpanded(property.group) ? ' expanded' : ' collapsed'
        }

        if (property.itemType == 'property' && !property.showExternalParam) {
            result += ' no-external-parameter'
        }

        return result
    }

    Surface.prototype.applyHeadColspan = function(th, property) {
        if (property.itemType == 'group') {
            th.setAttribute('colspan',  2)
        }
    }

    Surface.prototype.buildGroupExpandControl = function(titleSpan, property, force, hasChildSurface) {
        if (property.itemType !== 'group' && !force) {
            return
        }

        var groupIndex = this.generateGroupIndex(property.property),
            statusClass = this.isGroupExpanded(groupIndex) ? 'expanded' : '',
            anchor = document.createElement('a')

        anchor.setAttribute('class', 'expandControl ' + statusClass)
        anchor.setAttribute('href', 'javascript:;')
        anchor.setAttribute('data-group-index', groupIndex)

        if (hasChildSurface) {
            anchor.setAttribute('data-has-child-surface', 'true')
        }

        anchor.innerHTML = '<span>Expand/collapse</span>'

        titleSpan.appendChild(anchor)
    }

    Surface.prototype.buildPropertyDescription = function(property) {
        if (property.description === undefined || property.description === null) {
            return null
        }

        var span = document.createElement('span')
        span.setAttribute('title', this.escapeJavascriptString(property.description))
        span.setAttribute('class', 'info oc-icon-info with-tooltip')

        $(span).tooltip({ placement: 'auto right', container: 'body', delay: 500 })

        return span
    }

    Surface.prototype.buildExternalParameterEditor = function(tbody) {
        var rows = tbody.children

        for (var i = 0, len = rows.length; i < len; i++) {
            var row = rows[i],
                property = row.getAttribute('data-property')

            if ($.oc.foundation.element.hasClass(row, 'no-external-parameter') || !property) {
                continue
            }

            var propertyEditor = this.findPropertyEditor(property)
            if (propertyEditor && !propertyEditor.supportsExternalParameterEditor()) {
                continue
            }

            var cell = row.querySelector('td'),
                propertyDefinition = this.findPropertyDefinition(property),
                editor = new $.oc.inspector.externalParameterEditor(this, propertyDefinition, cell)

            this.externalParameterEditors.push(editor)
        }
    }

    //
    // Field grouping
    //

    Surface.prototype.applyGroupIndexAttribute = function(property, row) {
        if (property.groupIndex !== undefined && property.itemType == 'property' && !property.groupedControl) {
            row.setAttribute('data-group-index', property.groupIndex)
        }
    }

    Surface.prototype.isGroupExpanded = function(group) {
        var statuses = this.loadGroupStatuses()

        if (statuses[group] !== undefined)
            return statuses[group]

        return false
    }

    Surface.prototype.loadGroupStatuses = function() {
        var statuses = this.getInspectorGroupStatuses(),
            root = this.getRootSurface()

        if (statuses[root.inspectorUniqueId] !== undefined) {
            return statuses[root.inspectorUniqueId]
        }

        return {}
    }

    Surface.prototype.writeGroupStatuses = function(updatedStatuses) {
        var statuses = this.getInspectorGroupStatuses(),
            root = this.getRootSurface()

        statuses[root.inspectorUniqueId] = updatedStatuses

        this.setInspectorGroupStatuses(statuses)
    }

    Surface.prototype.getInspectorGroupStatuses = function() {
        var statuses = document.body.getAttribute('data-inspector-group-statuses')

        if (statuses !== null) {
            return JSON.parse(statuses)
        }

        return {}
    }

    Surface.prototype.setInspectorGroupStatuses = function(statuses) {
        document.body.setAttribute('data-inspector-group-statuses', JSON.stringify(statuses))
    }

    Surface.prototype.toggleGroup = function(row) {
        var link = row.querySelector('a'),
            groupIndex = link.getAttribute('data-group-index'),
            hasChildSurface = link.getAttribute('data-has-child-surface'),
            collapse = true,
            statuses = this.loadGroupStatuses(),
            propertyRows = []

        if (!hasChildSurface) {
            propertyRows = this.tableContainer.querySelectorAll('tr[data-group-index="'+groupIndex+'"]')
        }
        else {
            var editor = this.findRowPropertyEditor(row)

            if (!editor) {
                throw new Error('Cannot find editor for the property ' + property)
            }

            propertyRows = editor.getChildInspectorRows()
        }

        var duration = Math.round(50 / propertyRows.length),
            rowsArray = Array.prototype.slice.call(propertyRows)

        if ($.oc.foundation.element.hasClass(link, 'expanded')) {
            $.oc.foundation.element.removeClass(link, 'expanded')
            statuses[groupIndex] = false
        } else {
            $.oc.foundation.element.addClass(link, 'expanded')
            collapse = false
            statuses[groupIndex] = true
        }

        this.expandOrCollapseRows(rowsArray, collapse, duration)

        this.writeGroupStatuses(statuses)
    }

    Surface.prototype.expandOrCollapseRows = function(rows, collapse, duration) {
        var row = rows.pop(),
            self = this

        if (row) {
            setTimeout(function toggleRow() {
                $.oc.foundation.element.toggleClass(row, 'collapsed', collapse)
                $.oc.foundation.element.toggleClass(row, 'expanded', !collapse)

                self.expandOrCollapseRows(rows, collapse, duration)
            }, duration)
        }
    }

    //
    // Editors
    //

    Surface.prototype.buildEditor = function(row, property, dataTable) {
        if (property.itemType !== 'property') {
            return
        }

        this.validateEditorType(property.type)

        var cell = document.createElement('td'),
            type = property.type

        row.appendChild(cell)

        if (type === undefined) {
            type = 'string'
        }

        var editor = new $.oc.inspector.propertyEditors[type](this, property, cell)

        if (editor.isGroupedEditor()) {
            $.oc.foundation.element.addClass(dataTable, 'has-groups')
            $.oc.foundation.element.addClass(row, 'control-group')

            property.groupIndex = editor.getGroupIndex()
            property.groupedControl = true
            this.buildGroupExpandControl(row.querySelector('span.title-element'), property, true, editor.hasChildSurface())

            if (cell.children.length == 0) {
                // If the editor hasn't added any elements to the cell,
                // and it's a grouped control, remove the cell and
                // make the group title full-width.
                row.querySelector('th').setAttribute('colspan', 2)
                row.removeChild(cell)
            }
        }
        
        this.editors.push(editor)
    }

    Surface.prototype.generateSequencedId = function() {
        this.idCounter ++

        return this.inspectorUniqueId + '-' + this.idCounter
    }

    //
    // Internal API for the editors
    //

    Surface.prototype.getPropertyValue = function(property) {
        return this.values[property]
    }

    Surface.prototype.setPropertyValue = function(property, value, supressChangeEvents, forceEditorUpdate) {
        this.values[property] = value

        if (!supressChangeEvents) {
            if (this.originalValues[property] === undefined || !this.comparePropertyValues(this.originalValues[property], value)) {
                this.markPropertyChanged(property, true)
            } 
            else {
                this.markPropertyChanged(property, false)
            }

            this.notifyEditorsPropertyChanged(property, value)

            if (this.options.onChange !== null) {
                this.options.onChange(property, value)
            }
        }

        if (forceEditorUpdate) {
            var editor = this.findPropertyEditor(property)
            if (editor) {
                editor.updateDisplayedValue(value)
            }
        }

        return value
    }

    Surface.prototype.notifyEditorsPropertyChanged = function(property, value) {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i]

            editor.onInspectorPropertyChanged(property, value)
        }
    }

    Surface.prototype.makeCellActive = function(cell) {
        var tbody = cell.parentNode.parentNode.parentNode, // cell / row / tbody
            cells = tbody.querySelectorAll('tr td')

        for (var i = 0, len = cells.length; i < len; i++) {
            $.oc.foundation.element.removeClass(cells[i], 'active')
        }

        $.oc.foundation.element.addClass(cell, 'active')
    }

    Surface.prototype.markPropertyChanged = function(property, changed) {
        var row = this.tableContainer.querySelector('tr[data-property="'+property+'"]')

        if (changed) {
            $.oc.foundation.element.addClass(row, 'changed')
        }
        else {
            $.oc.foundation.element.removeClass(row, 'changed')
        }
    }

    Surface.prototype.findPropertyEditor = function(property) {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            if (this.editors[i].getPropertyName() == property)
                return this.editors[i]
        }

        return null
    }

    Surface.prototype.findRowPropertyEditor = function(row) {
        var inspectorId = row.getAttribute('data-inspector-id'),
            propertyName = row.getAttribute('data-property')

        if (!inspectorId || !propertyName) {
            throw new Error('Cannot find property editor for a row with unknown property name or inspector ID.')
        }

        for (var i = 0, len = this.editors.length; i < len; i++) {
            var result = this.editors[i].findEditorByInspectorIdAndPropertyName(inspectorId, propertyName)

            if (result) {
                return result
            }
        }

        return null
    }

    Surface.prototype.findExternalParameterEditor = function(property) {
        for (var i = 0, len = this.externalParameterEditors.length; i < len; i++) {
            if (this.externalParameterEditors[i].getPropertyName() == property)
                return this.externalParameterEditors[i]
        }

        return null
    }

    Surface.prototype.findPropertyDefinition = function(property) {
        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var definition = this.parsedProperties.properties[i]

            if (definition.property == property) {
                return definition
            }
        }

        return null
    }

    Surface.prototype.validateEditorType = function(type) {
        if (type === undefined) {
            type = 'string'
        }

        if ($.oc.inspector.propertyEditors[type] === undefined) {
            throw new Error('The Inspector editor class "' + type + 
                '" is not defined in the $.oc.inspector.propertyEditors namespace.')
        }
    }

    Surface.prototype.generateGroupIndex = function(propertyName) {
        return this.getInspectorUniqueId() + '-' + propertyName
    }

    //
    // Nested surfaces support
    //

    Surface.prototype.mergeChildSurface = function(surface, mergeAfterRow) {
        var rows = surface.tableContainer.querySelectorAll('table.inspector-fields > tbody > tr')

        for (var i = rows.length-1; i >= 0; i--) {
            var row = rows[i],
                th = this.getRowHeadElement(row)

            if (th === null) {
                throw new Error('Cannot find TH element for the Inspector row')
            }

            mergeAfterRow.parentNode.insertBefore(row, mergeAfterRow.nextSibling)
            th.children[0].style.marginLeft = row.getAttribute('data-inspector-level')*10 + 'px'
        }
    }

    Surface.prototype.getRowHeadElement = function(row) {
        for (var i = row.children.length-1; i >= 0; i--) {
            var element = row.children[i]

            if (element.tagName === 'TH') {
                return element
            }
        }

        return null
    }

    Surface.prototype.getInspectorUniqueId = function() {
        return this.inspectorUniqueId
    }

    Surface.prototype.getRootSurface = function() {
        var current = this

        while (current) {
            if (!current.parentSurface) {
                return current
            }

            current = current.parentSurface
        }
    }

    //
    // Disposing
    //

    Surface.prototype.removeElements = function() {
        this.tableContainer.parentNode.removeChild(this.tableContainer);
    }

    Surface.prototype.disposeEditors = function() {
        for (var i = 0, len = this.editors.length; i < len; i++) {
            var editor = this.editors[i]

            editor.dispose()
        }
    }

    Surface.prototype.disposeExternalParameterEditors = function() {
        for (var i = 0, len = this.externalParameterEditors.length; i < len; i++) {
            var editor = this.externalParameterEditors[i]

            editor.dispose()
        }
    }

    Surface.prototype.disposeControls = function() {
        var tooltipControls = this.tableContainer.querySelectorAll('.with-tooltip')

        for (var i = 0, len = tooltipControls.length; i < len; i++) {
            $(tooltipControls[i]).tooltip('destroy')
        }
    }

    //
    // Helpers
    //

    Surface.prototype.escapeJavascriptString = function(str) {
        var div = document.createElement('div')
        div.appendChild(document.createTextNode(str))
        return div.innerHTML
    }

    Surface.prototype.comparePropertyValues = function(oldValue, newValue) {
        if (oldValue === undefined && newValue !== undefined) {
            return false
        }

        if (oldValue !== undefined && newValue === undefined) {
            return false
        }

        if (typeof oldValue == 'object' && typeof newValue == 'object') {
            return JSON.stringify(oldValue) == JSON.stringify(newValue)
        }

        return oldValue == newValue
    }

    //
    // External API
    //

    Surface.prototype.getValues = function() {
        var result = {}

// TODO: implement validation in this method. It should be optional,
// as the method is used by other classes internally, but the validation
// is required only for the external callers.

        for (var i=0, len = this.parsedProperties.properties.length; i < len; i++) {
            var property = this.parsedProperties.properties[i]

            if (property.itemType !== 'property') {
                continue
            }

            var value = null,
                externalParameterEditor = this.findExternalParameterEditor(property.property)

            if (!externalParameterEditor || !externalParameterEditor.isEditorVisible()) {
                value = this.getPropertyValue(property.property)

                if (value === undefined) {
                    value = property.default
                }
            } 
            else {
                value = externalParameterEditor.getValue()
                value = '{{ ' + value + ' }}'
            }

            result[property.property] = value
        }

        return result
    }

    // EVENT HANDLERS
    //

    Surface.prototype.onGroupClick = function(ev) {
        var row = ev.currentTarget

        this.toggleGroup(row)

        $.oc.foundation.event.stop(ev)
        return false
    }

    // DEFAULT OPTIONS
    // ============================

    Surface.DEFAULTS = {
        enableExternalParameterEditor: false,
        surfaceLevel: 0, // For internal use
        onChange: null
    }

    // REGISTRATION
    // ============================

    $.oc.inspector.surface = Surface

}(window.jQuery);